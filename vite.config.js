import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const MAX_BODY_BYTES = 20 * 1024 * 1024;

const readJsonBody = req =>
  new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    let tooLarge = false;

    req.on('data', chunk => {
      if (tooLarge) return;

      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('Payload too large. Use a smaller image.');
        error.statusCode = 413;
        tooLarge = true;
        reject(error);
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (tooLarge) return;

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });

    req.on('error', reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const createDashboardApiPlugin = env => {
  const handleAnalyzeDashboard = async (req, res, next) => {
    if (!req.url?.startsWith('/api/analyze-dashboard')) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }

    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const model = env.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      sendJson(res, 500, {
        error: 'Missing GEMINI_API_KEY. Add it to .env and restart the dev server.'
      });
      return;
    }

    try {
      const contentLengthHeader = req.headers['content-length'];
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: 'Payload too large. Use a smaller image.' });
        return;
      }

      const { prompt, mimeType, imageBase64 } = await readJsonBody(req);

      if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
        sendJson(res, 400, { error: 'Invalid image payload.' });
        return;
      }

      const requestPayload = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  typeof prompt === 'string' && prompt.trim()
                    ? prompt
                    : 'Analyze this dashboard screenshot and return JSON data.'
              },
              {
                inlineData: {
                  mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'image/png',
                  data: imageBase64
                }
              }
            ]
          }
        ],
        generationConfig: { responseMimeType: 'application/json' }
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        }
      );

      const rawText = await response.text();
      let parsed = {};
      try {
        parsed = rawText ? JSON.parse(rawText) : {};
      } catch {
        parsed = {};
      }

      if (!response.ok) {
        const message =
          parsed?.error?.message ||
          parsed?.error ||
          `Gemini request failed with status ${response.status}.`;
        sendJson(res, response.status, { error: message });
        return;
      }

      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string' || !text.trim()) {
        sendJson(res, 502, { error: 'Model returned no extractable JSON content.' });
        return;
      }

      let extractedData = {};
      try {
        extractedData = JSON.parse(text);
      } catch {
        sendJson(res, 502, { error: 'Model output was not valid JSON.' });
        return;
      }

      sendJson(res, 200, { extractedData });
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      sendJson(res, statusCode, {
        error: error instanceof Error ? error.message : 'Unexpected server error.'
      });
    }
  };

  return {
    name: 'dashboard-api',
    configureServer(server) {
      server.middlewares.use(handleAnalyzeDashboard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleAnalyzeDashboard);
    }
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), createDashboardApiPlugin(env)]
  };
});
