import React, { useState, useMemo, useRef } from 'react';
import { Download, LayoutTemplate, FileCode2, Eye, Activity, DollarSign, LayoutDashboard, UploadCloud, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';

const NUMERIC_FIELDS = new Set([
  'totalRevenue',
  'revenueCoverage',
  'funnelCoverage',
  'widgetUtilization',
  'productRev',
  'postPurchaseRev',
  'checkoutRev',
  'thankYouRev',
  'cartRev',
  'otherRev',
  'widget1Rev',
  'widget2Rev',
  'widget3Rev',
  'projectedCurrent',
  'projectedOptimized'
]);

const SCORE_FIELDS = new Set(['revenueCoverage', 'funnelCoverage', 'widgetUtilization']);
const TEXT_FIELDS = new Set(['storeName', 'optimizationPercent', 'widget1Name', 'widget2Name', 'widget3Name']);
const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024;
const EXCEL_ACCEPT_TYPES = '.xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

const EXCEL_HEADER_ALIASES = {
  storeName: ['store name', 'store', 'shop name', 'shop'],
  optimizationPercent: ['optimization percent', 'optimization coverage', 'optimization', 'coverage percent'],
  totalRevenue: ['total revenue', 'revenue', 'total wiser revenue', 'wiser revenue'],
  revenueCoverage: ['revenue coverage'],
  funnelCoverage: ['funnel coverage'],
  widgetUtilization: ['widget utilization'],
  productRev: ['product rev', 'product page', 'product page revenue', 'product revenue'],
  postPurchaseRev: ['post purchase rev', 'post purchase', 'post-purchase', 'post purchase revenue'],
  checkoutRev: ['checkout rev', 'checkout', 'checkout revenue'],
  thankYouRev: ['thank you rev', 'thank you', 'thankyou', 'thank you revenue'],
  cartRev: ['cart rev', 'cart', 'cart revenue'],
  otherRev: ['other rev', 'other', 'others', 'other revenue'],
  widget1Name: ['widget 1 name', 'top widget 1 name', 'first widget name'],
  widget1Rev: ['widget 1 rev', 'widget 1 revenue', 'top widget 1 revenue', 'first widget revenue'],
  widget2Name: ['widget 2 name', 'top widget 2 name', 'second widget name'],
  widget2Rev: ['widget 2 rev', 'widget 2 revenue', 'top widget 2 revenue', 'second widget revenue'],
  widget3Name: ['widget 3 name', 'top widget 3 name', 'third widget name'],
  widget3Rev: ['widget 3 rev', 'widget 3 revenue', 'top widget 3 revenue', 'third widget revenue'],
  projectedCurrent: ['projected current', 'current monthly', 'current projection'],
  projectedOptimized: ['projected optimized', 'with optimization', 'optimized projection']
};

const normalizeHeaderKey = value =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const EXCEL_FIELD_LOOKUP = (() => {
  const lookup = new Map();

  for (const [field, labels] of Object.entries(EXCEL_HEADER_ALIASES)) {
    lookup.set(normalizeHeaderKey(field), field);
    for (const label of labels) {
      lookup.set(normalizeHeaderKey(label), field);
    }
  }

  return lookup;
})();

const toSafeNumber = (value, fallback = 0) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    let normalized = trimmed
      .replace(/\$/g, '')
      .replace(/,/g, '')
      .replace(/%/g, '')
      .replace(/\s+/g, '');

    if (/^\(.*\)$/.test(normalized)) {
      normalized = `-${normalized.slice(1, -1)}`;
    }

    const stringParsed = Number(normalized);
    if (Number.isFinite(stringParsed)) return stringParsed;

    const matchedNumber = normalized.match(/-?\d+(\.\d+)?/);
    if (matchedNumber) {
      const extracted = Number(matchedNumber[0]);
      return Number.isFinite(extracted) ? extracted : fallback;
    }

    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const sanitizeText = (value, fallback = '') => {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>&]/g, '')
    .trim();
  return text || fallback;
};

const DEFAULT_NORMALIZED_DATA = {
  storeName: 'Unknown',
  optimizationPercent: '',
  totalRevenue: 0,
  revenueCoverage: 0,
  funnelCoverage: 0,
  widgetUtilization: 0,
  productRev: 0,
  postPurchaseRev: 0,
  checkoutRev: 0,
  thankYouRev: 0,
  cartRev: 0,
  otherRev: 0,
  widget1Name: '',
  widget1Rev: 0,
  widget2Name: '',
  widget2Rev: 0,
  widget3Name: '',
  widget3Rev: 0,
  projectedCurrent: 0,
  projectedOptimized: 0
};

const normalizeIncomingData = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const normalized = {};

  for (const field of TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      normalized[field] = sanitizeText(input[field], field === 'storeName' ? 'Unknown' : '');
    }
  }

  for (const field of NUMERIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const value = toSafeNumber(input[field], 0);
      normalized[field] = SCORE_FIELDS.has(field) ? clamp(value, 0, 100) : value;
    }
  }

  return normalized;
};

const normalizeReportData = (input = {}) => {
  return {
    ...DEFAULT_NORMALIZED_DATA,
    ...normalizeIncomingData(input)
  };
};

const extractExcelData = worksheet => {
  const mappedData = {};

  const rowObjects = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
  for (const row of rowObjects) {
    const rowMatch = {};

    for (const [header, value] of Object.entries(row)) {
      const field = EXCEL_FIELD_LOOKUP.get(normalizeHeaderKey(header));
      if (field && value !== '') {
        rowMatch[field] = value;
      }
    }

    if (Object.keys(rowMatch).length > 0) {
      Object.assign(mappedData, rowMatch);
      break;
    }
  }

  const matrixRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
  for (const row of matrixRows) {
    if (!Array.isArray(row) || row.length < 2) continue;

    const field = EXCEL_FIELD_LOOKUP.get(normalizeHeaderKey(row[0]));
    const value = row[1];
    if (field && value !== '' && !Object.prototype.hasOwnProperty.call(mappedData, field)) {
      mappedData[field] = value;
    }
  }

  return mappedData;
};

const ReportGenerator = () => {
  // --- State for the Report Data ---
  const [data, setData] = useState({
    storeName: 'Wooden Ships',
    optimizationPercent: '60-65',
    totalRevenue: 31371.00,
    
    // Health Scores
    revenueCoverage: 65,
    funnelCoverage: 55,
    widgetUtilization: 50,
    
    // Revenue by Page
    productRev: 24498.91,
    postPurchaseRev: 5145.00,
    checkoutRev: 862.85,
    thankYouRev: 450.00,
    cartRev: 149.00,
    otherRev: 265.24,
    
    // Top Widgets
    widget1Name: 'Related Products',
    widget1Rev: 20163.21,
    widget2Name: 'Inspired by Your Views',
    widget2Rev: 3311.90,
    widget3Name: 'Top Selling Products',
    widget3Rev: 1438.00,
    
    // Projections
    projectedCurrent: 15685,
    projectedOptimized: 23685
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isParsingSpreadsheet, setIsParsingSpreadsheet] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef(null);
  const spreadsheetInputRef = useRef(null);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setErrorMsg(
        `Image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please use an image under 8 MB.`
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg("");

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const fileData = typeof reader.result === 'string' ? reader.result : '';
        const base64Data = fileData.includes(',') ? fileData.split(',')[1] : '';
        if (!base64Data) {
          throw new Error('Invalid image data');
        }

        const mimeType = file.type || 'image/png';
        const prompt = `Analyze this analytics dashboard screenshot. Extract the data and return a JSON object.
Use EXACTLY these keys:
- storeName (string)
- optimizationPercent (string, e.g. "60-65")
- totalRevenue (number)
- revenueCoverage (number 0-100)
- funnelCoverage (number 0-100)
- widgetUtilization (number 0-100)
- productRev (number)
- postPurchaseRev (number)
- checkoutRev (number)
- thankYouRev (number)
- cartRev (number)
- otherRev (number)
- widget1Name (string)
- widget1Rev (number)
- widget2Name (string)
- widget2Rev (number)
- widget3Name (string)
- widget3Rev (number)
- projectedCurrent (number)
- projectedOptimized (number)

IMPORTANT:
1. If a specific value is missing from the image, make your best reasonable guess based on the visible data, or default to 0 for numbers and "Unknown" for strings.`;

        // Route through a backend endpoint to keep API keys off the client.
        const payload = { prompt, mimeType, imageBase64: base64Data };
        const delays = [1000, 2000, 4000, 8000, 16000];
        const maxAttempts = delays.length + 1;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const response = await fetch('/api/analyze-dashboard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            let result = {};
            try {
              result = await response.json();
            } catch {
              result = {};
            }

            if (!response.ok) {
              const apiError = typeof result?.error === 'string' ? result.error : `HTTP error ${response.status}`;
              throw new Error(apiError);
            }

            const extractedData =
              result?.extractedData ??
              result?.data ??
              (result?.candidates?.[0]?.content?.parts?.[0]?.text
                ? JSON.parse(result.candidates[0].content.parts[0].text)
                : result);

            const normalizedExtractedData = normalizeIncomingData(extractedData);
            if (Object.keys(normalizedExtractedData).length === 0) {
              throw new Error('Invalid analysis response');
            }

            setData(prev => ({ ...prev, ...normalizedExtractedData }));
            return;
          } catch (err) {
            const isLastAttempt = attempt === maxAttempts - 1;
            if (isLastAttempt) {
              setErrorMsg(
                err instanceof Error && err.message
                  ? err.message
                  : "Failed to analyze image. Please try again or fill the fields manually."
              );
            } else {
              await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            }
          }
        }
      } catch (err) {
        setErrorMsg("Unable to read the uploaded image. Please try another file.");
      } finally {
        setIsAnalyzing(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.onerror = () => {
      setErrorMsg("Unable to read the uploaded image. Please try another file.");
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const handleSpreadsheetUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setErrorMsg(
        `Spreadsheet is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please use a file under 8 MB.`
      );
      if (spreadsheetInputRef.current) spreadsheetInputRef.current.value = "";
      return;
    }

    setIsParsingSpreadsheet(true);
    setErrorMsg("");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames?.[0];
      if (!firstSheetName) {
        throw new Error('The spreadsheet has no sheets.');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const extractedData = extractExcelData(worksheet);
      const normalizedData = normalizeIncomingData(extractedData);
      if (Object.keys(normalizedData).length === 0) {
        throw new Error('Could not map spreadsheet columns to report fields.');
      }

      setData(prev => ({ ...prev, ...normalizedData }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : "Failed to read spreadsheet. Please check the file format."
      );
    } finally {
      setIsParsingSpreadsheet(false);
      if (spreadsheetInputRef.current) spreadsheetInputRef.current.value = "";
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setData(prev => {
      if (NUMERIC_FIELDS.has(name)) {
        if (value === '') return { ...prev, [name]: '' };
        const parsed = Number(value);
        return { ...prev, [name]: Number.isFinite(parsed) ? parsed : prev[name] };
      }

      if (TEXT_FIELDS.has(name)) {
        return { ...prev, [name]: sanitizeText(value) };
      }

      return { ...prev, [name]: value };
    });
  };

  // --- HTML Template Builder ---
  const generateHTML = useMemo(() => {
    const safeData = normalizeReportData(data);

    // Calculate Percentages
    const revenueBase = safeData.totalRevenue > 0 ? safeData.totalRevenue : 0;
    const w1Pct = (revenueBase > 0 ? clamp((safeData.widget1Rev / revenueBase) * 100, 0, 100) : 0).toFixed(1);
    const w2Pct = (revenueBase > 0 ? clamp((safeData.widget2Rev / revenueBase) * 100, 0, 100) : 0).toFixed(1);
    const w3Pct = (revenueBase > 0 ? clamp((safeData.widget3Rev / revenueBase) * 100, 0, 100) : 0).toFixed(1);
    const optimizationNumber = toSafeNumber(String(safeData.optimizationPercent).split('-')[0], safeData.revenueCoverage);
    const revenueTrend = `+${Math.max(4, Math.round(optimizationNumber / 6))}%`;
    const coverageTrend = `+${Math.max(0.2, safeData.funnelCoverage / 180).toFixed(1)}%`;
    const checkoutDelta = safeData.checkoutRev - safeData.thankYouRev;
    const aovTrend = `${checkoutDelta >= 0 ? '+' : '-'}${Math.max(0.3, Math.abs(checkoutDelta) / 300).toFixed(1)}%`;
    const stockBadge = safeData.widgetUtilization >= 60
      ? 'Stable'
      : safeData.widgetUtilization >= 45
        ? 'Watchlist'
        : 'Risk';
    const stockBadgeClass = safeData.widgetUtilization >= 60
      ? 'bg-emerald-100 text-emerald-700'
      : safeData.widgetUtilization >= 45
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
    const revenueDataLiteral = [
      safeData.productRev,
      safeData.postPurchaseRev,
      safeData.checkoutRev,
      safeData.thankYouRev,
      safeData.cartRev,
      safeData.otherRev
    ].join(', ');
    const widgetDataLiteral = [safeData.widget1Rev, safeData.widget2Rev, safeData.widget3Rev].join(', ');
    const widgetLabelLiteral = [safeData.widget1Name, safeData.widget2Name, safeData.widget3Name]
      .map(label => JSON.stringify(label))
      .join(', ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wiser Performance Review: ${safeData.storeName}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        'wiser-red': '#F9423A',
                        'wiser-navy': '#1F2937',
                        'wiser-dark': '#111827',
                        'wiser-gray': '#F6F6F7',
                        'wiser-border': '#E1E3E5',
                        'wiser-green': '#008060',
                        'wiser-yellow': '#FFC453',
                    },
                    fontFamily: {
                        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'San Francisco', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
                    },
                    boxShadow: {
                        'card': '0 2px 5px rgba(0,0,0,0.05)',
                        'hover': '0 5px 15px rgba(0,0,0,0.08)',
                    }
                }
            }
        }
    </script>
    <style>
        body { background: linear-gradient(180deg, #f3f4f6 0%, #eef2f7 100%); color: #1F2937; font-family: 'Manrope', sans-serif; }
        .chart-container { position: relative; width: 100%; max-width: 600px; margin-left: auto; margin-right: auto; height: 300px; max-height: 400px; }
        @media (min-width: 768px) { .chart-container { height: 350px; } }
        .metric-card { background: white; border: 1px solid #E1E3E5; border-radius: 8px; transition: all 0.2s ease; }
        .metric-card:hover { border-color: #F9423A; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .tab-content { display: none; animation: fadeIn 0.3s ease-out; }
        .tab-content.active { display: block; }
        .tab-btn { position: relative; color: #475569; font-weight: 700; padding: 9px 16px; border-radius: 999px; transition: all 0.2s; }
        .tab-btn:hover { background: #e2e8f0; color: #0f172a; }
        .tab-btn.active { color: #fff; font-weight: 700; background: #0f172a; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .progress-bg { background-color: #F1F2F3; border-radius: 4px; height: 8px; width: 100%; overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 4px; transition: width 1s ease-in-out; }
    </style>
</head>
<body class="font-sans antialiased pb-20 flex flex-col min-h-screen">
    <header class="bg-white border-b border-wiser-border sticky top-0 z-50 backdrop-blur">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex flex-col md:flex-row justify-between items-center py-4">
                <div class="flex items-center space-x-3">
                    <div class="h-12 w-12 bg-gradient-to-br from-red-500 to-orange-400 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm">${safeData.storeName.charAt(0) || '?'}</div>
                    <div>
                        <h1 class="text-3xl font-extrabold text-wiser-navy leading-tight">${safeData.storeName} Intelligence</h1>
                        <p class="text-xs text-gray-500">Q4 Store Review <span class="mx-2">-</span> <span class="bg-emerald-100 px-2 py-1 rounded-full text-emerald-700 font-semibold">${optimizationNumber}% Optimized</span></p>
                    </div>
                </div>
                <div class="mt-4 md:mt-0 flex items-center space-x-3">
                    <button onclick="window.print()" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50">Export PDF</button>
                    <button class="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-700">Scan New Image</button>
                </div>
            </div>
            <div class="flex space-x-3 mt-4 overflow-x-auto no-scrollbar border-t border-gray-100 pt-2">
                <button onclick="switchTab('overview')" class="tab-btn active text-sm">Overview</button>
                <button onclick="switchTab('wins')" class="tab-btn text-sm">Performance Wins</button>
                <button onclick="switchTab('improvements')" class="tab-btn text-sm">Live Improvements</button>
                <button onclick="switchTab('opportunities')" class="tab-btn text-sm">Growth Gaps</button>
                <button onclick="switchTab('action')" class="tab-btn text-sm">Action Roadmap</button>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 flex-grow">
        <!-- TAB 1: OVERVIEW -->
        <div id="overview" class="tab-content active space-y-8">
            <div class="space-y-3">
                <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <div>
                        <p class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Total Revenue</p>
                        <p class="mt-1 text-4xl font-extrabold text-slate-900">$${safeData.totalRevenue.toLocaleString()}</p>
                    </div>
                    <span class="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-700">${revenueTrend}</span>
                </div>
                <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <div>
                        <p class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Revenue Coverage</p>
                        <p class="mt-1 text-4xl font-extrabold text-slate-900">${safeData.revenueCoverage}%</p>
                    </div>
                    <span class="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-700">${coverageTrend}</span>
                </div>
                <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <div>
                        <p class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Avg Order Value</p>
                        <p class="mt-1 text-4xl font-extrabold text-slate-900">$${safeData.checkoutRev.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    </div>
                    <span class="rounded-lg ${checkoutDelta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'} px-3 py-2 text-sm font-bold">${aovTrend}</span>
                </div>
                <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <div>
                        <p class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Stock Health</p>
                        <p class="mt-1 text-4xl font-extrabold text-slate-900">${safeData.widgetUtilization}%</p>
                    </div>
                    <span class="rounded-lg ${stockBadgeClass} px-3 py-2 text-sm font-bold">${stockBadge}</span>
                </div>
            </div>

            <div class="bg-white rounded-2xl border-4 border-slate-900/90 shadow-lg p-6 relative overflow-hidden">
                <div class="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-red-50"></div>
                <div class="relative">
                    <h2 class="text-2xl font-extrabold text-wiser-navy">Executive Summary</h2>
                    <p class="text-gray-600 mt-2 leading-relaxed text-lg">
                        ${safeData.storeName} is currently operating at <strong class="text-wiser-navy">${safeData.revenueCoverage}% efficiency</strong> across the digital sales funnel.
                        Growth is primarily led by <strong class="text-emerald-700">${safeData.widget1Name}</strong>, while the next focus should be stabilizing conversion pressure points and
                        improving widget activation where utilization sits at <strong class="text-red-600">${safeData.widgetUtilization}%</strong>.
                    </p>
                </div>
            </div>
            <div>
                <h3 class="text-sm font-black text-slate-700 uppercase mb-4 tracking-[0.2em]">System Health Scorecard</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="metric-card p-6 flex flex-col items-center">
                        <h4 class="text-base font-bold text-slate-800 mb-1">Revenue Coverage</h4>
                        <p class="text-xs text-slate-500 mb-4">Exceeded Q4 forecast</p>
                        <div class="chart-container" style="height: 160px; max-height: 160px;"><canvas id="healthRevenueChart"></canvas></div>
                        <p class="text-3xl font-bold text-wiser-navy mt-[-60px] z-10">${safeData.revenueCoverage}%</p>
                        <div class="mt-8 text-center w-full border-t border-gray-100 pt-4"><span class="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full mb-1">Strong Core</span><p class="text-xs text-gray-500">Driven by Product Pages.</p></div>
                    </div>
                    <div class="metric-card p-6 flex flex-col items-center">
                        <h4 class="text-base font-bold text-slate-800 mb-1">Mobile Conversion</h4>
                        <p class="text-xs text-slate-500 mb-4">Post-checkout redesign</p>
                        <div class="chart-container" style="height: 160px; max-height: 160px;"><canvas id="healthFunnelChart"></canvas></div>
                        <p class="text-3xl font-bold text-wiser-navy mt-[-60px] z-10">${safeData.funnelCoverage}%</p>
                        <div class="mt-8 text-center w-full border-t border-gray-100 pt-4"><span class="inline-block px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full mb-1">Channel Leader</span><p class="text-xs text-gray-500">Collections/Search improving.</p></div>
                    </div>
                    <div class="metric-card p-6 flex flex-col items-center">
                        <h4 class="text-base font-bold text-slate-800 mb-1">Stock Availability</h4>
                        <p class="text-xs text-slate-500 mb-4">Utilization risk profile</p>
                        <div class="chart-container" style="height: 160px; max-height: 160px;"><canvas id="healthWidgetChart"></canvas></div>
                        <p class="text-3xl font-bold text-wiser-red mt-[-60px] z-10">${safeData.widgetUtilization}%</p>
                        <div class="mt-8 text-center w-full border-t border-gray-100 pt-4"><span class="inline-block px-3 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-full mb-1">High Risk</span><p class="text-xs text-gray-500">FBT & Bundles missing.</p></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- TAB 2: WINS -->
        <div id="wins" class="tab-content space-y-6">
            <div class="flex flex-col lg:flex-row gap-6">
                <div class="flex-1">
                    <div class="metric-card p-6">
                        <h2 class="text-lg font-bold text-wiser-navy mb-1">Part 1: Best Performing Areas</h2>
                        <div class="overflow-hidden border border-gray-200 rounded-lg mt-6">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead class="bg-gray-50">
                                    <tr><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Page Type</th><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Revenue</th><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th></tr>
                                </thead>
                                <tbody class="bg-white divide-y divide-gray-100">
                                    <tr class="hover:bg-gray-50"><td class="px-6 py-3 text-sm font-medium text-gray-900">Product Page</td><td class="px-6 py-3 text-sm font-bold text-wiser-navy">$${safeData.productRev.toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td class="px-6 py-3"><span class="px-2 py-1 text-xs font-bold rounded bg-green-100 text-green-800">Strong</span></td></tr>
                                    <tr class="hover:bg-gray-50"><td class="px-6 py-3 text-sm font-medium text-gray-900">Post-Purchase</td><td class="px-6 py-3 text-sm font-bold text-wiser-navy">$${safeData.postPurchaseRev.toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td class="px-6 py-3"><span class="px-2 py-1 text-xs font-bold rounded bg-green-100 text-green-800">Strong</span></td></tr>
                                    <tr class="hover:bg-gray-50"><td class="px-6 py-3 text-sm font-medium text-gray-900">Checkout Page</td><td class="px-6 py-3 text-sm text-gray-500">$${safeData.checkoutRev.toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td class="px-6 py-3"><span class="px-2 py-1 text-xs font-bold rounded bg-yellow-100 text-yellow-800">Moderate</span></td></tr>
                                    <tr class="hover:bg-gray-50"><td class="px-6 py-3 text-sm font-medium text-gray-900">Thank You Page</td><td class="px-6 py-3 text-sm text-gray-500">$${safeData.thankYouRev.toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td class="px-6 py-3"><span class="px-2 py-1 text-xs font-bold rounded bg-yellow-100 text-yellow-800">Moderate</span></td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="w-full lg:w-1/3 metric-card p-6 flex flex-col">
                    <h3 class="text-xs font-bold text-gray-400 uppercase mb-4 text-center">Revenue Split</h3>
                    <div class="chart-container flex-grow" style="height: 200px;"><canvas id="revenueByPageChart"></canvas></div>
                </div>
            </div>

            <!-- Widgets Section -->
            <div class="metric-card p-8">
                <div class="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
                    <h3 class="text-lg font-bold text-wiser-navy">Widget Performance Breakdown</h3>
                    <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Total: $${safeData.totalRevenue.toLocaleString()}</span>
                </div>
                
                <div class="flex flex-col lg:flex-row gap-10">
                    <div class="w-full lg:w-3/5"><div class="chart-container"><canvas id="topWidgetsChart"></canvas></div></div>
                    <div class="w-full lg:w-2/5 space-y-6">
                        <div>
                            <div class="flex justify-between items-end mb-1">
                                <div><p class="text-xs text-wiser-red uppercase font-bold">Top Winner</p><p class="font-bold text-gray-800 text-base">${safeData.widget1Name}</p></div>
                                <div class="text-right"><p class="text-base text-wiser-navy font-bold">$${safeData.widget1Rev.toLocaleString()}</p><p class="text-xs text-gray-500">${w1Pct}% of Total</p></div>
                            </div>
                            <div class="progress-bg"><div class="progress-fill bg-wiser-red" style="width: ${w1Pct}%"></div></div>
                        </div>
                        <div>
                            <div class="flex justify-between items-end mb-1">
                                <div><p class="text-xs text-wiser-navy uppercase font-bold">High Intent</p><p class="font-bold text-gray-800 text-base">${safeData.widget2Name}</p></div>
                                <div class="text-right"><p class="text-base text-wiser-navy font-bold">$${safeData.widget2Rev.toLocaleString()}</p><p class="text-xs text-gray-500">${w2Pct}% of Total</p></div>
                            </div>
                            <div class="progress-bg"><div class="progress-fill bg-wiser-navy" style="width: ${w2Pct}%"></div></div>
                        </div>
                        <div>
                            <div class="flex justify-between items-end mb-1">
                                <div><p class="text-xs text-gray-400 uppercase font-bold">Social Proof</p><p class="font-bold text-gray-800 text-base">${safeData.widget3Name}</p></div>
                                <div class="text-right"><p class="text-base text-wiser-navy font-bold">$${safeData.widget3Rev.toLocaleString()}</p><p class="text-xs text-gray-500">${w3Pct}% of Total</p></div>
                            </div>
                            <div class="progress-bg"><div class="progress-fill bg-gray-400" style="width: ${w3Pct}%"></div></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Other tabs (Improvements, Opportunities, Action) remain static structurally but dynamic values injected if needed -->
        <div id="improvements" class="tab-content space-y-6">
             <div class="bg-blue-50 p-4 rounded border border-blue-100 flex items-start">
                <span class="text-blue-500 text-xl mr-3">TIP</span>
                <div><h2 class="text-md font-bold text-blue-800">Optimization Opportunity</h2><p class="text-sm text-blue-700">These areas are live but under-monetized. Quick fixes here can drive a <strong class="underline">10-15% Revenue Lift</strong>.</p></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- Card 1 -->
                <div class="metric-card flex flex-col p-0 overflow-hidden">
                    <div class="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center"><h3 class="font-bold text-md text-wiser-navy">Cart Page</h3><span class="text-xs font-bold text-wiser-yellow bg-yellow-50 px-2 py-1 rounded">Needs Focus</span></div>
                    <div class="p-6 flex-grow"><p class="text-xs text-gray-400 uppercase font-bold mb-2">Strategy</p><p class="text-wiser-red font-bold text-lg mb-2">Better Placement</p><p class="text-sm text-gray-600">Move widgets <strong>above the fold</strong>. Visibility is key before checkout.</p><p class="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">Current: $${safeData.cartRev.toLocaleString()}</p></div>
                </div>
                 <!-- Card 2 -->
                <div class="metric-card flex flex-col p-0 overflow-hidden">
                    <div class="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center"><h3 class="font-bold text-md text-wiser-navy">Thank You Page</h3><span class="text-xs font-bold text-wiser-yellow bg-yellow-50 px-2 py-1 rounded">Needs Focus</span></div>
                    <div class="p-6 flex-grow"><p class="text-xs text-gray-400 uppercase font-bold mb-2">Strategy</p><p class="text-wiser-red font-bold text-lg mb-2">Bundle Offers</p><p class="text-sm text-gray-600">Add <strong>multi-item recommendations</strong> to spark repeat purchases.</p><p class="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">Current: $${safeData.thankYouRev.toLocaleString()}</p></div>
                </div>
                 <!-- Card 3 -->
                <div class="metric-card flex flex-col p-0 overflow-hidden">
                    <div class="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center"><h3 class="font-bold text-md text-wiser-navy">Checkout Page</h3><span class="text-xs font-bold text-wiser-yellow bg-yellow-50 px-2 py-1 rounded">Needs Focus</span></div>
                    <div class="p-6 flex-grow"><p class="text-xs text-gray-400 uppercase font-bold mb-2">Strategy</p><p class="text-wiser-red font-bold text-lg mb-2">Upsell Scaling</p><p class="text-sm text-gray-600">Increase <strong>offer value</strong>. Use logic to nudge AOV higher.</p><p class="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">Current: $${safeData.checkoutRev.toLocaleString()}</p></div>
                </div>
            </div>
        </div>

        <div id="opportunities" class="tab-content space-y-6">
            <div class="bg-red-50 p-4 rounded border border-red-100 flex items-start">
                <span class="text-wiser-red text-xl mr-3">GAP</span>
                <div><h2 class="text-md font-bold text-red-800">Missed Opportunities (The Growth Gap)</h2><p class="text-sm text-red-700">Activating these high-traffic areas is the fastest way to unlock <strong class="underline">+15-25% Incremental Revenue</strong>.</p></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="metric-card p-8">
                    <h3 class="text-lg font-bold text-wiser-navy mb-6">Untapped High-Value Zones</h3>
                    <ul class="space-y-6">
                        <li class="flex items-start"><span class="flex-shrink-0 h-6 w-6 rounded bg-red-100 text-wiser-red flex items-center justify-center font-bold text-xs mt-1">0</span><div class="ml-4"><h4 class="text-sm font-bold text-wiser-navy">Cart Drawer & Collection Pages</h4><p class="text-sm text-gray-500 mt-1">Generating <strong>$0 Revenue</strong>. Essential for discovery.</p></div></li>
                        <li class="flex items-start"><span class="flex-shrink-0 h-6 w-6 rounded bg-red-100 text-wiser-red flex items-center justify-center font-bold text-xs mt-1">0</span><div class="ml-4"><h4 class="text-sm font-bold text-wiser-navy">Search & Order Status Pages</h4><p class="text-sm text-gray-500 mt-1">Generating <strong>$0 Revenue</strong>. High-intent moments wasted.</p></div></li>
                        <li class="flex items-start"><span class="flex-shrink-0 h-6 w-6 rounded bg-yellow-100 text-yellow-700 flex items-center justify-center font-bold text-xs mt-1">!</span><div class="ml-4"><h4 class="text-sm font-bold text-wiser-navy">Frequently Bought Together (FBT)</h4><p class="text-sm text-gray-500 mt-1"><strong>Not Live.</strong> Critical for AOV.</p></div></li>
                    </ul>
                </div>
                <div class="metric-card p-6 flex flex-col">
                    <h3 class="text-sm font-bold text-gray-500 uppercase mb-4">Revenue Potential Modeling</h3>
                    <div class="chart-container flex-grow"><canvas id="projectionChart"></canvas></div>
                    <div class="mt-4 text-center">
                        <p class="text-gray-600 text-sm">Projected Monthly Lift</p>
                        <p class="text-2xl font-bold text-wiser-green">+$5,000 - $8,000</p>
                    </div>
                </div>
            </div>
        </div>

        <div id="action" class="tab-content space-y-6">
             <div class="bg-white rounded-lg shadow-card border border-gray-200 overflow-hidden">
                <div class="bg-wiser-navy p-8 text-white text-center">
                    <h2 class="text-2xl font-bold">Strategic Roadmap</h2>
                    <p class="text-gray-400 mt-2">Steps to move from "Growing" to "Optimized"</p>
                </div>
                <div class="p-8 max-w-4xl mx-auto space-y-6">
                    <div class="flex items-center p-4 border border-gray-200 rounded-lg hover:border-wiser-red transition-colors group bg-gray-50">
                        <div class="flex-shrink-0 h-10 w-10 bg-wiser-red rounded-full flex items-center justify-center font-bold text-white shadow-sm">1</div>
                        <div class="ml-4 flex-grow"><h3 class="font-bold text-md text-wiser-navy">Unlock the "Growth Gap"</h3><p class="text-sm text-gray-500">Activate <strong>Cart Drawer</strong> & <strong>Collection Page</strong> widgets. Turn on FBT.</p></div>
                        <div class="text-right"><span class="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded">+$5k/mo Impact</span></div>
                    </div>
                    <div class="flex items-center p-4 border border-gray-200 rounded-lg hover:border-wiser-navy transition-colors group bg-white">
                        <div class="flex-shrink-0 h-10 w-10 bg-wiser-navy rounded-full flex items-center justify-center font-bold text-white shadow-sm">2</div>
                        <div class="ml-4 flex-grow"><h3 class="font-bold text-md text-wiser-navy">Optimize Placements</h3><p class="text-sm text-gray-500">Move Cart widgets above fold. Add multi-item bundles to Thank You page.</p></div>
                        <div class="text-right"><span class="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded">+15% Lift</span></div>
                    </div>
                    <div class="flex items-center p-4 border border-gray-200 rounded-lg hover:border-gray-400 transition-colors group bg-white">
                        <div class="flex-shrink-0 h-10 w-10 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center font-bold shadow-sm">3</div>
                        <div class="ml-4 flex-grow"><h3 class="font-bold text-md text-wiser-navy">Monitor & Scale</h3><p class="text-sm text-gray-500">Review in 30 days. Scale Upsell offers based on data.</p></div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <footer class="text-center text-gray-400 mt-12 mb-8 pt-4">
        <p class="text-xs font-medium">Generated for ${safeData.storeName} - System Version 2.1</p>
    </footer>

    <!-- JavaScript Logic -->
    <script>
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            const buttons = document.getElementsByTagName('button');
            for (let btn of buttons) {
                if (btn.getAttribute('onclick') === \`switchTab('\${tabId}')\`) {
                    btn.classList.add('active');
                    break;
                }
            }
            const chartInstances = Chart.instances instanceof Map
                ? Array.from(Chart.instances.values())
                : Object.values(Chart.instances || {});
            chartInstances.forEach(chart => chart.resize());
        }

        function wrapLabel(label) {
            if (typeof label !== 'string' || label.length <= 16) return label;
            const words = label.split(' ');
            const lines = [];
            let currentLine = words[0];
            for (let i = 1; i < words.length; i++) {
                if (currentLine.length + 1 + words[i].length <= 16) {
                    currentLine += ' ' + words[i];
                } else {
                    lines.push(currentLine);
                    currentLine = words[i];
                }
            }
            lines.push(currentLine);
            return lines;
        }

        const commonTooltipConfig = {
            backgroundColor: '#1F2937', padding: 12, cornerRadius: 4,
            titleFont: { family: 'Inter', size: 13, weight: 'bold' }, bodyFont: { family: 'Inter', size: 12 },
            callbacks: {
                title: function(tooltipItems) {
                    const item = tooltipItems[0];
                    let label = item.chart.data.labels[item.dataIndex];
                    return Array.isArray(label) ? label.join(' ') : label;
                }
            }
        };

        // Inject Dynamic Variables into Chart.js
        const revenueData = [${revenueDataLiteral}];
        const widgetData = [${widgetDataLiteral}];
        const widgetLabels = [${widgetLabelLiteral}];

        const ctxRevenue = document.getElementById('revenueByPageChart').getContext('2d');
        new Chart(ctxRevenue, {
            type: 'doughnut',
            data: {
                labels: ['Product Page', 'Post-Purchase', 'Checkout', 'Thank You', 'Cart', 'Others'].map(wrapLabel),
                datasets: [{ data: revenueData, backgroundColor: ['#F9423A', '#1F2937', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB'], borderWidth: 2, borderColor: '#ffffff', hoverOffset: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, font: {size: 11, family: 'Inter'} } }, tooltip: commonTooltipConfig } }
        });

        const ctxWidgets = document.getElementById('topWidgetsChart').getContext('2d');
        new Chart(ctxWidgets, {
            type: 'bar',
            data: {
                labels: widgetLabels.map(wrapLabel),
                datasets: [{ label: 'Revenue ($)', data: widgetData, backgroundColor: ['#F9423A', '#1F2937', '#9CA3AF'], borderRadius: 4, barThickness: 35 }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, grid: { display: false } }, y: { grid: { display: false }, ticks: { font: { family: 'Inter', weight: 500 } } } }, plugins: { legend: { display: false }, tooltip: commonTooltipConfig } }
        });

        function createGauge(id, score, color) {
            new Chart(document.getElementById(id).getContext('2d'), {
                type: 'doughnut',
                data: { labels: ['Score', 'Gap'], datasets: [{ data: [score, 100 - score], backgroundColor: [color, '#E5E7EB'], borderWidth: 0, circumference: 180, rotation: 270, cutout: '85%' }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
            });
        }
        createGauge('healthRevenueChart', ${safeData.revenueCoverage}, '#3B82F6');
        createGauge('healthFunnelChart', ${safeData.funnelCoverage}, '#10B981');
        createGauge('healthWidgetChart', ${safeData.widgetUtilization}, '#EF4444');

        new Chart(document.getElementById('projectionChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Current Monthly', 'With Optimization'],
                datasets: [{ label: 'Revenue Estimate', data: [${safeData.projectedCurrent}, ${safeData.projectedOptimized}], backgroundColor: ['#9CA3AF', '#008060'], borderRadius: 4, barPercentage: 0.6 }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: '#F3F4F6' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: commonTooltipConfig } }
        });
    </script>
</body>
</html>`;
  }, [data]);

  const downloadFile = () => {
    const blob = new Blob([generateHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeFileStoreName =
      sanitizeText(data.storeName, 'Store')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'Store';
    a.href = url;
    a.download = `Wiser_Report_${safeFileStoreName}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // UI Component helper
  const InputGroup = ({ label, name, type = "text", prefix }) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-2 text-gray-500">{prefix}</span>}
        <input
          type={type}
          name={name}
          value={data[name]}
          onChange={handleInputChange}
          className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-red-500 focus:border-red-500 sm:text-sm ${prefix ? 'pl-8' : ''}`}
        />
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      {/* Top Navbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-red-500 p-2 rounded-md">
            <LayoutTemplate className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Wiser Report Generator</h1>
            <p className="text-xs text-gray-500">Create client performance dashboards instantly</p>
          </div>
        </div>
        <button
          onClick={downloadFile}
          className="flex items-center space-x-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md font-medium text-sm transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" />
          <span>Download HTML Report</span>
        </button>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT PANEL - Editor Form */}
        <div className="w-1/3 bg-white border-r border-gray-200 overflow-y-auto shrink-0 flex flex-col">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center text-gray-700 font-semibold text-sm uppercase tracking-wider">
            <FileCode2 className="w-4 h-4 mr-2" /> Data Inputs
          </div>
          
          <div className="p-6 space-y-8">
            {/* AI Image Upload */}
            <section className="bg-blue-50 p-4 rounded-lg border border-blue-100">
              <h3 className="text-sm font-bold text-blue-900 mb-2 flex items-center">
                <UploadCloud className="w-4 h-4 mr-2 text-blue-600" /> Auto-Fill via Image
              </h3>
              <p className="text-xs text-blue-700 mb-3">Upload a screenshot of your analytics dashboard. We'll extract the data automatically.</p>
              
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload} 
                ref={fileInputRef}
                className="hidden" 
                id="analytics-upload"
              />
              <label 
                htmlFor="analytics-upload"
                className={`flex items-center justify-center w-full px-4 py-2 text-sm font-medium rounded-md border border-blue-300 shadow-sm cursor-pointer transition-colors ${isAnalyzing ? 'bg-blue-200 text-blue-800' : 'bg-white text-blue-700 hover:bg-blue-100'}`}
              >
                {isAnalyzing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Image...</>
                ) : (
                  <><UploadCloud className="w-4 h-4 mr-2" /> Select Image</>
                )}
              </label>
              {errorMsg && <p className="mt-2 text-xs text-red-600">{errorMsg}</p>}
            </section>

            {/* Spreadsheet Upload */}
            <section className="bg-green-50 p-4 rounded-lg border border-green-100">
              <h3 className="text-sm font-bold text-green-900 mb-2 flex items-center">
                <UploadCloud className="w-4 h-4 mr-2 text-green-600" /> Auto-Fill via Excel
              </h3>
              <p className="text-xs text-green-700 mb-3">Upload a spreadsheet with matching column names or key/value rows for report fields.</p>

              <input
                type="file"
                accept={EXCEL_ACCEPT_TYPES}
                onChange={handleSpreadsheetUpload}
                ref={spreadsheetInputRef}
                className="hidden"
                id="spreadsheet-upload"
              />
              <label
                htmlFor="spreadsheet-upload"
                className={`flex items-center justify-center w-full px-4 py-2 text-sm font-medium rounded-md border border-green-300 shadow-sm cursor-pointer transition-colors ${isParsingSpreadsheet ? 'bg-green-200 text-green-800' : 'bg-white text-green-700 hover:bg-green-100'}`}
              >
                {isParsingSpreadsheet ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading Spreadsheet...</>
                ) : (
                  <><UploadCloud className="w-4 h-4 mr-2" /> Select Excel/CSV</>
                )}
              </label>
            </section>

            {/* General Settings */}
            <section>
              <h3 className="text-md font-bold text-gray-900 mb-4 flex items-center border-b pb-2">
                <LayoutDashboard className="w-4 h-4 mr-2 text-red-500" /> General Info
              </h3>
              <InputGroup label="Store Name" name="storeName" />
              <InputGroup label="Optimization Coverage %" name="optimizationPercent" />
              <InputGroup label="Total Revenue" name="totalRevenue" type="number" prefix="$" />
            </section>

            {/* Health Scores */}
            <section>
              <h3 className="text-md font-bold text-gray-900 mb-4 flex items-center border-b pb-2">
                <Activity className="w-4 h-4 mr-2 text-red-500" /> Health Scores (0-100)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <InputGroup label="Revenue Coverage" name="revenueCoverage" type="number" />
                <InputGroup label="Funnel Coverage" name="funnelCoverage" type="number" />
                <InputGroup label="Widget Utilization" name="widgetUtilization" type="number" />
              </div>
            </section>

            {/* Revenue By Page */}
            <section>
              <h3 className="text-md font-bold text-gray-900 mb-4 flex items-center border-b pb-2">
                <DollarSign className="w-4 h-4 mr-2 text-red-500" /> Revenue By Page
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <InputGroup label="Product Page" name="productRev" type="number" prefix="$" />
                <InputGroup label="Post-Purchase" name="postPurchaseRev" type="number" prefix="$" />
                <InputGroup label="Checkout" name="checkoutRev" type="number" prefix="$" />
                <InputGroup label="Thank You" name="thankYouRev" type="number" prefix="$" />
                <InputGroup label="Cart" name="cartRev" type="number" prefix="$" />
                <InputGroup label="Other" name="otherRev" type="number" prefix="$" />
              </div>
            </section>

            {/* Top Widgets */}
            <section>
              <h3 className="text-md font-bold text-gray-900 mb-4 flex items-center border-b pb-2">
                <LayoutTemplate className="w-4 h-4 mr-2 text-red-500" /> Top Widgets
              </h3>
              <div className="bg-gray-50 p-4 rounded-md border border-gray-100 mb-4">
                <InputGroup label="Widget 1 Name" name="widget1Name" />
                <InputGroup label="Widget 1 Revenue" name="widget1Rev" type="number" prefix="$" />
              </div>
              <div className="bg-gray-50 p-4 rounded-md border border-gray-100 mb-4">
                <InputGroup label="Widget 2 Name" name="widget2Name" />
                <InputGroup label="Widget 2 Revenue" name="widget2Rev" type="number" prefix="$" />
              </div>
              <div className="bg-gray-50 p-4 rounded-md border border-gray-100">
                <InputGroup label="Widget 3 Name" name="widget3Name" />
                <InputGroup label="Widget 3 Revenue" name="widget3Rev" type="number" prefix="$" />
              </div>
            </section>

            {/* Projections */}
            <section>
              <h3 className="text-md font-bold text-gray-900 mb-4 flex items-center border-b pb-2">
                <Activity className="w-4 h-4 mr-2 text-red-500" /> Projections
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <InputGroup label="Current Monthly" name="projectedCurrent" type="number" prefix="$" />
                <InputGroup label="With Optimization" name="projectedOptimized" type="number" prefix="$" />
              </div>
            </section>
          </div>
        </div>

        {/* RIGHT PANEL - Live Preview */}
        <div className="flex-1 flex flex-col bg-gray-200 p-6 overflow-hidden relative">
          <div className="absolute top-8 right-10 bg-gray-800 text-white text-xs px-3 py-1 rounded-full opacity-50 flex items-center pointer-events-none z-10">
            <Eye className="w-3 h-3 mr-2" /> Live Preview
          </div>
          <div className="flex-1 bg-white rounded-xl shadow-lg border border-gray-300 overflow-hidden">
             {/* Using an iframe to render the raw HTML exactly as it will be downloaded */}
            <iframe 
              srcDoc={generateHTML}
              title="Report Preview"
              className="w-full h-full border-none"
              sandbox="allow-scripts"
            />
          </div>
        </div>

      </div>
    </div>
  );
};

export default ReportGenerator;


