import React, { useState, useRef } from 'react';

// --- DYNAMIC COLOR GENERATOR (GOLDEN RATIO HSL) ---
const getRunColor = (id) => {
  const hue = (id * 137.508) % 360;
  return `hsl(${Math.round(hue)}, 85%, 62%)`;
};

// --- MATRIX INVERSE HELPER (GAUSS-JORDAN) ---
function matrixInverse(M) {
  const n = M.length;
  let A = M.map((row, i) => {
    let r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    let temp = A[i]; A[i] = A[maxRow]; A[maxRow] = temp;

    if (Math.abs(A[i][i]) < 1e-12) return null;

    let pivot = A[i][i];
    for (let j = 0; j < 2 * n; j++) A[i][j] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k !== i) {
        let factor = A[k][i];
        for (let j = 0; j < 2 * n; j++) {
          A[k][j] -= factor * A[i][j];
        }
      }
    }
  }
  return A.map(row => row.slice(n));
}

function createDiagramPng(svgElement, benchmarks, results) {
  if (!svgElement) {
    throw new Error('Network topology diagram is not available.');
  }

  const svg = svgElement.cloneNode(true);
  const namespace = 'http://www.w3.org/2000/svg';
  const scale = 3;
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width * scale;
  const height = viewBox.height * scale;
  svg.setAttribute('xmlns', namespace);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.removeAttribute('class');
  svg.querySelectorAll('[opacity]').forEach((element) => element.removeAttribute('opacity'));

  svg.querySelectorAll('g[aria-label^="Run "]').forEach((group) => {
    const runId = Number(group.getAttribute('aria-label').match(/\d+/)?.[0]);
    const residual = results.residuals.find((run) => run.id === runId);
    const visibleLine = Array.from(group.querySelectorAll('line')).find((line) => line.getAttribute('stroke') !== 'transparent');
    if (visibleLine) visibleLine.setAttribute('stroke-width', residual?.isBlunder ? '2.5' : '1.8');
  });

  const fixedNames = new Set(benchmarks.map((benchmark) => benchmark.name.trim()).filter(Boolean));
  svg.querySelectorAll('g[aria-label^="Highlight station "]').forEach((group) => {
    const station = group.getAttribute('aria-label').replace('Highlight station ', '');
    const circles = group.querySelectorAll('circle');
    if (circles[0]) circles[0].setAttribute('r', '22');
    if (circles[1]) {
      circles[1].setAttribute('r', '20');
      circles[1].setAttribute('stroke', fixedNames.has(station) ? '#34d399' : '#22d3ee');
      circles[1].setAttribute('stroke-width', '2');
    }
  });

  const background = document.createElementNS(namespace, 'rect');
  background.setAttribute('width', String(viewBox.width));
  background.setAttribute('height', String(viewBox.height));
  background.setAttribute('fill', '#FFFFFF');
  svg.insertBefore(background, svg.firstChild);

  const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], {
    type: 'image/svg+xml;charset=utf-8'
  });
  const objectUrl = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Unable to create a canvas for the topology image.'));
        return;
      }
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to render the network topology SVG.'));
    };
    image.src = objectUrl;
  });
}

// --- NETWORK DIAGRAM COMPONENT ---
function NetworkDiagram({ benchmarks, levelRuns, results, hoveredRunId, hoveredStation, onHoverRun, onHoverStation }) {
  const NODE_RADIUS = 20;
  const PARALLEL_GAP = 12;

  const fixedNames = new Set(benchmarks.map(b => b.name.trim()).filter(Boolean));
  const allStations = Array.from(new Set([
    ...benchmarks.map(b => b.name.trim()),
    ...levelRuns.flatMap(r => [r.from.trim(), r.to.trim()])
  ])).filter(Boolean);

  if (allStations.length === 0) return null;

  const width = 380;
  const height = 260;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 45;

  const nodeCoords = {};
  allStations.forEach((st, idx) => {
    const angle = (idx / allStations.length) * 2 * Math.PI - Math.PI / 2;
    nodeCoords[st] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      isFixed: fixedNames.has(st)
    };
  });

  const edgeGroups = {};
  levelRuns.forEach((run, idx) => {
    const from = run.from.trim();
    const to = run.to.trim();
    if (!from || !to) return;
    const pairKey = [from, to].sort().join('-');
    if (!edgeGroups[pairKey]) edgeGroups[pairKey] = [];
    edgeGroups[pairKey].push({ ...run, originalIndex: idx + 1 });
  });

  const renderableRuns = [];

  Object.values(edgeGroups).forEach((group) => {
    const count = group.length;

    group.forEach((run, index) => {
      const fromNode = nodeCoords[run.from.trim()];
      const toNode = nodeCoords[run.to.trim()];
      if (!fromNode || !toNode) return;

      const isCanonical = run.from.trim() < run.to.trim();
      const p1 = isCanonical ? fromNode : toNode;
      const p2 = isCanonical ? toNode : fromNode;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return;

      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;

      const offset = (index - (count - 1) / 2) * PARALLEL_GAP;

      const p1Offset = { x: p1.x + nx * offset, y: p1.y + ny * offset };
      const p2Offset = { x: p2.x + nx * offset, y: p2.y + ny * offset };

      const startPos = isCanonical ? p1Offset : p2Offset;
      const endPos = isCanonical ? p2Offset : p1Offset;

      const ldx = endPos.x - startPos.x;
      const ldy = endPos.y - startPos.y;
      const llen = Math.sqrt(ldx * ldx + ldy * ldy);
      const lux = ldx / llen;
      const luy = ldy / llen;

      const startTrunc = {
        x: startPos.x + lux * NODE_RADIUS,
        y: startPos.y + luy * NODE_RADIUS,
      };
      const endTrunc = {
        x: endPos.x - lux * (NODE_RADIUS + 5),
        y: endPos.y - luy * (NODE_RADIUS + 5),
      };

      let t;
      if (count > 1) {
        t = 0.28 + (index * 0.44) / Math.max(1, count - 1);
      } else {
        t = (run.originalIndex % 2 === 0) ? 0.32 : 0.68;
      }

      const sideShift = (run.originalIndex % 2 === 0 ? 8 : -8);
      const linePointX = p1Offset.x + (p2Offset.x - p1Offset.x) * t;
      const linePointY = p1Offset.y + (p2Offset.y - p1Offset.y) * t;

      const labelPos = {
        x: linePointX + nx * sideShift,
        y: linePointY + ny * sideShift,
      };

      const res = results?.residuals.find(r => r.id === run.originalIndex);
      const dynamicColor = getRunColor(run.originalIndex);

      renderableRuns.push({
        ...run,
        runId: run.originalIndex,
        start: startTrunc,
        end: endTrunc,
        labelPos,
        isBlunder: res?.isBlunder,
        color: res?.isBlunder ? '#f43f5e' : dynamicColor
      });
    });
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg mb-6">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
          LEVELING NETWORK DIAGRAM
        </h3>
        <div className="flex gap-3 text-[10px] text-slate-400 font-medium">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block"></span> Known BM
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-cyan-500 rounded-full inline-block"></span> Unknown BM
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full inline-block"></span> Blunder
          </span>
        </div>
      </div>

      <svg id="network-topology-svg" viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-slate-950/60 rounded-lg border border-slate-800/80">
        <defs>
          {renderableRuns.map((run) => (
            <marker
              key={`arrow-${run.runId}`}
              id={`arrow-${run.runId}`}
              markerWidth="5"
              markerHeight="5"
              refX="4"
              refY="2.5"
              orient="auto"
            >
              <polygon points="0 0, 5 2.5, 0 5" fill={run.color} />
            </marker>
          ))}
        </defs>

        {renderableRuns.map((run) => (
          <g
            key={run.runId}
            onMouseEnter={() => {
              onHoverStation(null);
              onHoverRun(run.runId);
            }}
            onMouseLeave={() => onHoverRun(null)}
            onFocus={() => {
              onHoverStation(null);
              onHoverRun(run.runId);
            }}
            onBlur={() => onHoverRun(null)}
            tabIndex="0"
            role="button"
            aria-label={`Run ${run.runId}: ${run.from} to ${run.to}`}
            className="cursor-pointer"
          >
            <line
              x1={run.start.x}
              y1={run.start.y}
              x2={run.end.x}
              y2={run.end.y}
              stroke="transparent"
              strokeWidth="14"
              pointerEvents="stroke"
            />
            <line
              x1={run.start.x}
              y1={run.start.y}
              x2={run.end.x}
              y2={run.end.y}
              stroke={run.color}
              strokeWidth={hoveredRunId === run.runId || run.from.trim() === hoveredStation || run.to.trim() === hoveredStation ? "4" : run.isBlunder ? "2.5" : "1.8"}
              strokeDasharray={run.isBlunder ? "4 2" : "none"}
              markerEnd={`url(#arrow-${run.runId})`}
              opacity={hoveredRunId == null && hoveredStation == null || hoveredRunId === run.runId || run.from.trim() === hoveredStation || run.to.trim() === hoveredStation ? "1" : "0.2"}
            />
          </g>
        ))}

        {Object.entries(nodeCoords).map(([stName, coord]) => (
          <g
            key={stName}
            transform={`translate(${coord.x},${coord.y})`}
            onMouseEnter={() => {
              onHoverRun(null);
              onHoverStation(stName);
            }}
            onMouseLeave={() => onHoverStation(null)}
            onFocus={() => {
              onHoverRun(null);
              onHoverStation(stName);
            }}
            onBlur={() => onHoverStation(null)}
            tabIndex="0"
            role="button"
            aria-label={`Highlight station ${stName}`}
            className="cursor-pointer"
            opacity={hoveredRunId == null && hoveredStation == null || hoveredStation === stName || [levelRuns[hoveredRunId - 1]?.from?.trim(), levelRuns[hoveredRunId - 1]?.to?.trim()].includes(stName) ? "1" : "0.35"}
          >
            <circle
              r={hoveredStation === stName ? NODE_RADIUS + 10 : NODE_RADIUS + 2}
              fill={coord.isFixed ? 'rgba(16, 185, 129, 0.24)' : 'rgba(6, 182, 212, 0.24)'}
              className="transition-all duration-150"
            />
            <circle
              r={hoveredStation === stName ? NODE_RADIUS + 3 : NODE_RADIUS}
              fill={coord.isFixed ? '#059669' : '#0891b2'}
              stroke={hoveredStation === stName ? '#ffffff' : coord.isFixed ? '#34d399' : '#22d3ee'}
              strokeWidth={hoveredStation === stName ? "3" : "2"}
              className="transition-all duration-150"
            />
            <text
              textAnchor="middle"
              dy="4"
              fill="#ffffff"
              fontSize="12"
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              {stName}
            </text>
          </g>
        ))}

        {renderableRuns.map((run) => (
          <g
            key={`label-${run.runId}`}
            transform={`translate(${run.labelPos.x}, ${run.labelPos.y})`}
            onMouseEnter={() => {
              onHoverStation(null);
              onHoverRun(run.runId);
            }}
            onMouseLeave={() => onHoverRun(null)}
            onFocus={() => onHoverRun(run.runId)}
            onBlur={() => onHoverRun(null)}
            tabIndex="0"
            role="button"
            aria-label={`Highlight run ${run.runId}`}
            className="cursor-pointer"
            opacity={hoveredRunId == null && hoveredStation == null || hoveredRunId === run.runId || run.from.trim() === hoveredStation || run.to.trim() === hoveredStation ? "1" : "0.35"}
          >
            <rect
              x="-13"
              y="-9"
              width="26"
              height="18"
              rx="4"
              fill="#0f172a"
              stroke={run.color}
              strokeWidth="1.2"
            />
            <text
              x="0"
              y="3.5"
              textAnchor="middle"
              fill={run.color}
              fontSize="10"
              fontWeight="700"
              fontFamily="sans-serif"
            >
              #{run.runId}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// --- MAIN APP COMPONENT ---
export default function App() {
  const [benchmarks, setBenchmarks] = useState([
    { id: '1', name: 'A', elevation: '100.000' },
    { id: '2', name: 'B', elevation: '105.050' }
  ]);

  const [levelRuns, setLevelRuns] = useState([
    { id: '1', from: 'A', to: 'C', dh: '8.100', weightType: 'Direct (P)', weightVal: '1' },
    { id: '2', from: 'B', to: 'C', dh: '3.002', weightType: 'Direct (P)', weightVal: '1' },
    { id: '3', from: 'A', to: 'D', dh: '6.250', weightType: 'Direct (P)', weightVal: '1' },
    { id: '4', from: 'B', to: 'D', dh: '1.235', weightType: 'Direct (P)', weightVal: '1' },
    { id: '5', from: 'C', to: 'A', dh: '-8.080', weightType: 'Direct (P)', weightVal: '1' }
  ]);

  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [reportGeneratedAt, setReportGeneratedAt] = useState('');
  const [hoveredRunId, setHoveredRunId] = useState(null);
  const [hoveredStation, setHoveredStation] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    confidence: '95',
    precision: 4,
    residualUnit: 'mm'
  });

  const bmFileInput = useRef(null);
  const runFileInput = useRef(null);

  // --- SAMPLE DATA LOAD ---
  const handleLoadSample = () => {
    setBenchmarks([
      { id: '1', name: 'A', elevation: '100.000' },
      { id: '2', name: 'B', elevation: '105.050' }
    ]);
    setLevelRuns([
      { id: '1', from: 'A', to: 'C', dh: '8.100', weightType: 'Direct (P)', weightVal: '1' },
      { id: '2', from: 'B', to: 'C', dh: '3.002', weightType: 'Direct (P)', weightVal: '1' },
      { id: '3', from: 'A', to: 'D', dh: '6.250', weightType: 'Direct (P)', weightVal: '1' },
      { id: '4', from: 'B', to: 'D', dh: '1.235', weightType: 'Direct (P)', weightVal: '1' },
      { id: '5', from: 'C', to: 'A', dh: '-8.080', weightType: 'Direct (P)', weightVal: '1' }
    ]);
    setResults(null);
    setErrorMsg('');
    setReportGeneratedAt('');
  };

  // --- CSV IMPORT HANDLERS ---
  const handleImportBMCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/);
      const parsed = [];
      lines.forEach((line, i) => {
        const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= 2 && cols[0] && !isNaN(parseFloat(cols[1]))) {
          parsed.push({
            id: `${Date.now()}-${i}`,
            name: cols[0],
            elevation: cols[1]
          });
        }
      });
      if (parsed.length > 0) setBenchmarks(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportRunCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/);
      const parsed = [];
      lines.forEach((line, i) => {
        const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= 3 && cols[0] && cols[1] && !isNaN(parseFloat(cols[2]))) {
          parsed.push({
            id: `${Date.now()}-${i}`,
            from: cols[0],
            to: cols[1],
            dh: cols[2],
            weightType: cols[3] || 'Direct (P)',
            weightVal: cols[4] || '1'
          });
        }
      });
      if (parsed.length > 0) setLevelRuns(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- EXPORT FUNCTIONS ---
  const handleExportCSV = () => {
    if (!results) return;

    const residualScale = settings.residualUnit === 'mm' ? 1000 : 1;
    const rows = [
      ['--- RADAPHOHT - LEAST SQUARES ADJUSTMENT RESULTS ---'],
      ['Standard Error of Unit Weight (s0)', results.s0.toFixed(6)],
      ['Redundancy (Degrees of Freedom)', results.dof],
      ['Sum of Weighted Residuals (VTPV)', results.vtpv.toFixed(6)],
      ['Confidence level (%)', settings.confidence],
      [],
      ['--- ADJUSTED STATION ELEVATIONS ---'],
      ['Order', 'Station ID', 'Status', 'Adjusted Elevation H (m)', 'Std. Error (m)'],
      ...results.adjustedStations.map((station, index) => [
        index + 1,
        station.station,
        station.isFixed ? 'FIXED' : 'ADJUSTED',
        station.elev.toFixed(settings.precision),
        station.isFixed ? '-' : station.se.toFixed(settings.precision)
      ]),
      [],
      ['--- RESIDUALS & BLUNDER DETECTION ---'],
      ['Run ID', 'From Station', 'To Station', 'Observed ΔH (m)', `Residual V (${settings.residualUnit})`, 'Weight (P)', 'Status'],
      ...results.residuals.map((run) => [
        `#${run.id}`, run.from, run.to, run.dh,
        (run.v_mm / 1000 * residualScale).toFixed(settings.precision),
        run.weight, run.isBlunder ? 'BLUNDER' : 'OK'
      ])
    ];

    const processRow = row => row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',');
    const csvContent = '\uFEFF' + rows.map(processRow).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `RADAPHOHT_Adjustment_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = async () => {
    if (!results) return;

    try {
      setErrorMsg('');
      const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
        import('exceljs'),
        import('file-saver')
      ]);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'RADAPHOHT';
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet('Adjustment Results', {
        views: [{ state: 'frozen', ySplit: 9 }]
      });
      const navy = '0F172A';
      const darkSlate = '1E293B';
      const lightSlate = 'F1F5F9';
      const zebra = 'F8FAFC';
      const borderColor = 'CBD5E1';
      const thinBorder = {
        top: { style: 'thin', color: { argb: `FF${borderColor}` } },
        left: { style: 'thin', color: { argb: `FF${borderColor}` } },
        bottom: { style: 'thin', color: { argb: `FF${borderColor}` } },
        right: { style: 'thin', color: { argb: `FF${borderColor}` } }
      };

      const title = worksheet.getCell('A1');
      title.value = 'RADAPHOHT - LEAST SQUARES ADJUSTMENT RESULTS';
      worksheet.mergeCells('A1:F1');
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${navy}` } };
      title.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 28;

      worksheet.getCell('A2').value = `Generated: ${reportGeneratedAt || new Date().toLocaleString()}`;
      worksheet.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: 'FF475569' } };
      worksheet.mergeCells('A2:F2');
      worksheet.getRow(2).height = 20;

      const summary = [
        ['Standard Error of Unit Weight (s0)', results.s0],
        ['Redundancy (R)', results.dof],
        ['Sum of Weighted Squared Residuals (ΣPV²)', results.vtpv]
      ];
      summary.forEach(([label, value], index) => {
        const rowNumber = index + 4;
        worksheet.mergeCells(`A${rowNumber}:D${rowNumber}`);
        worksheet.mergeCells(`E${rowNumber}:F${rowNumber}`);
        const labelCell = worksheet.getCell(`A${rowNumber}`);
        const valueCell = worksheet.getCell(`E${rowNumber}`);
        labelCell.value = label;
        valueCell.value = value;
        labelCell.alignment = { horizontal: 'left', vertical: 'middle' };
        valueCell.alignment = { horizontal: 'right', vertical: 'middle' };
        if (typeof value === 'number' && index !== 1) valueCell.numFmt = '0.0000';
        [labelCell, valueCell].forEach((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${lightSlate}` } };
          cell.font = { name: 'Arial', size: 10, color: { argb: 'FF1E293B' } };
          cell.border = thinBorder;
        });
        worksheet.getRow(rowNumber).height = 21;
      });

      const elevationTitleRow = 8;
      const elevationHeaderRow = 9;
      const residualTitleRow = elevationHeaderRow + results.adjustedStations.length + 2;
      const residualHeaderRow = residualTitleRow + 1;
      const styleSectionTitle = (rowNumber, endColumn) => {
        worksheet.mergeCells(`A${rowNumber}:${endColumn}${rowNumber}`);
        const cell = worksheet.getCell(`A${rowNumber}`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${navy}` } };
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.border = thinBorder;
        worksheet.getRow(rowNumber).height = 22;
      };
      styleSectionTitle(elevationTitleRow, 'E');
      worksheet.getCell(`A${elevationTitleRow}`).value = 'ADJUSTED STATION ELEVATIONS';
      styleSectionTitle(residualTitleRow, 'F');
      worksheet.getCell(`A${residualTitleRow}`).value = 'LEVEL RUNS & RESIDUALS ANALYSIS';

      const styleTableHeader = (rowNumber, headers) => {
        const row = worksheet.getRow(rowNumber);
        row.values = headers;
        row.height = 24;
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${darkSlate}` } };
          cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = thinBorder;
        });
      };
      styleTableHeader(elevationHeaderRow, [
        'No.', 'Station ID', 'Type / Status', 'Adjusted Elevation H (m)', 'Std. Error (m)'
      ]);
      styleTableHeader(residualHeaderRow, [
        'Run ID', 'Path (From -> To)', 'Observed ΔH (m)', 'Residual V (mm)', 'Weight (P)', 'Status'
      ]);

      results.adjustedStations.forEach((station, index) => {
        const rowNumber = elevationHeaderRow + index + 1;
        const row = worksheet.getRow(rowNumber);
        row.values = [
          index + 1,
          station.station,
          station.isFixed ? 'Known Benchmark' : 'Adjusted',
          station.elev,
          station.se
        ];
        row.eachCell((cell, columnNumber) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : `FF${zebra}` }
          };
          cell.border = thinBorder;
          cell.alignment = {
            horizontal: [1, 2, 3].includes(columnNumber) ? 'center' : 'right',
            vertical: 'middle'
          };
          cell.font = { name: 'Arial', size: 10, color: { argb: 'FF1E293B' } };
        });
        row.getCell(4).numFmt = '0.0000';
        row.getCell(5).numFmt = '0.0000';
      });

      results.residuals.forEach((run, index) => {
        const rowNumber = residualHeaderRow + index + 1;
        const row = worksheet.getRow(rowNumber);
        row.values = [
          `#${run.id}`,
          `${run.from} -> ${run.to}`,
          run.dh,
          run.v_mm,
          run.weight,
          run.isBlunder ? 'BLUNDER' : 'OK'
        ];
        row.eachCell((cell, columnNumber) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : `FF${zebra}` }
          };
          cell.border = thinBorder;
          cell.alignment = {
            horizontal: [1, 6].includes(columnNumber) ? 'center' : columnNumber === 2 ? 'left' : 'right',
            vertical: 'middle'
          };
          cell.font = { name: 'Arial', size: 10, color: { argb: 'FF1E293B' } };
        });
        row.getCell(3).numFmt = '0.0000';
        row.getCell(4).numFmt = '+0.0000;-0.0000;0.0000';
        row.getCell(5).numFmt = '0.0000';
      });

      worksheet.columns.forEach((column, index) => {
        let maxLength = 0;
        worksheet.eachRow((row, rowNumber) => {
          if ([1, 2, elevationTitleRow, residualTitleRow, 4, 5, 6].includes(rowNumber)) return;
          const cell = row.getCell(index + 1);
          const value = cell.value;
          if (value !== null && value !== undefined) {
            const text = typeof value === 'object' && 'text' in value ? value.text : String(value);
            maxLength = Math.max(maxLength, String(text).length);
          }
        });
        column.width = maxLength + 5;
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `GEOLEVEL_NET_Adjustment_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (err) {
      setErrorMsg(`Excel export failed: ${err.message}`);
    }
  };

  const updateSetting = (field, value) => {
    setSettings(current => ({ ...current, [field]: value }));
  };

  const handleExportPDF = async () => {
    if (!results) return;

    try {
      setErrorMsg('');
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ]);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      const navy = [15, 23, 42];
      const slate = [71, 85, 105];
      const darkText = [30, 41, 59];
      const lightTint = [248, 250, 252];
      const generatedAt = reportGeneratedAt || new Date().toLocaleString();
      const knownBenchmarkCount = results.adjustedStations.filter((station) => station.isFixed).length;
      const totalRuns = results.residuals.length;

      pdf.setTextColor(...navy);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text('LEVELING NETWORK', margin, 18);
      pdf.text('ADJUSTMENT REPORT', margin, 24);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(...slate);
      pdf.text('Least Squares Adjustment Computation Sheet', margin, 30);

      pdf.setFillColor(...lightTint);
      pdf.setDrawColor(203, 213, 225);
      pdf.roundedRect(margin, 33, contentWidth, 15, 2, 2, 'FD');
      const metadata = [
        { label: 'DATE & TIME', value: generatedAt, x: margin + 4, width: 70 },
        { label: 'BENCHMARKS', value: String(knownBenchmarkCount), x: margin + 82, width: 35 },
        { label: 'LEVEL RUNS', value: String(totalRuns), x: margin + 130, width: 35 }
      ];
      metadata.forEach(({ label, value, x, width }) => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(...slate);
        pdf.text(label, x, 38);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...darkText);
        pdf.text(pdf.splitTextToSize(value, width), x, 43);
      });

      const summaryY = 53;
      const summaryGap = 4;
      const summaryWidth = (contentWidth - summaryGap * 2) / 3;
      const summaryItems = [
        { label: 'STANDARD DEVIATION (S', hasSubscriptZero: true, value: results.s0.toFixed(4) },
        { label: 'REDUNDANCY (R)', value: String(results.dof) },
        { label: 'WEIGHTED RESIDUAL SUM (VTPV)', value: results.vtpv.toFixed(4) }
      ];
      summaryItems.forEach((item, index) => {
        const x = margin + index * (summaryWidth + summaryGap);
        pdf.setFillColor(...lightTint);
        pdf.setDrawColor(203, 213, 225);
        pdf.roundedRect(x, summaryY, summaryWidth, 21, 2, 2, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(...slate);
        pdf.text(item.label, x + 4, summaryY + 6);
        if (item.hasSubscriptZero) {
          const prefixWidth = pdf.getTextWidth(item.label);
          pdf.setFontSize(5.5);
          const zeroWidth = pdf.getTextWidth('0');
          const subscriptGap = 0.6;
          pdf.text('0', x + 4 + prefixWidth + subscriptGap, summaryY + 7);
          pdf.setFontSize(8);
          pdf.text(')', x + 4 + prefixWidth + subscriptGap + zeroWidth, summaryY + 6);
        }
        pdf.setFontSize(12);
        pdf.setTextColor(...navy);
        pdf.text(item.value, x + 4, summaryY + 16);
      });

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(...navy);
      pdf.text('LEVELING NETWORK DIAGRAM', pageWidth / 2, 86, { align: 'center' });
      const diagramPng = await createDiagramPng(
        document.getElementById('network-topology-svg'),
        benchmarks,
        results
      );
      const diagramWidth = 100;
      const diagramHeight = diagramWidth * (260 / 380);
      pdf.addImage(diagramPng, 'PNG', (pageWidth - diagramWidth) / 2, 90, diagramWidth, diagramHeight);

      const headerPages = new Set();
      const drawTablePageHeader = () => {
        const pageNumber = pdf.internal.getCurrentPageInfo().pageNumber;
        if (pageNumber <= 1 || headerPages.has(pageNumber)) return;
        headerPages.add(pageNumber);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(...navy);
        pdf.text('LEVELING NETWORK ADJUSTMENT REPORT', margin, 12);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...slate);
        pdf.text('Least Squares Adjustment Computation Sheet', margin, 17);
        pdf.setDrawColor(203, 213, 225);
        pdf.line(margin, 20, pageWidth - margin, 20);
      };

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(...navy);
      pdf.text('1. KNOWN BENCHMARKS & ADJUSTED ELEVATIONS', margin, 162);
      autoTable(pdf, {
        startY: 166,
        margin: { left: margin, right: margin, top: 25, bottom: 22 },
        head: [['No.', 'Station ID', 'Type / Status', 'Adjusted Elevation Z (m)', 'Std. Error (m)']],
        body: results.adjustedStations.map((station, index) => [
          String(index + 1),
          station.station,
          station.isFixed ? 'Known Benchmark' : 'Adjusted',
          station.elev.toFixed(4),
          station.isFixed ? '-' : station.se.toFixed(4)
        ]),
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 8,
          textColor: darkText,
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
          cellPadding: 2.5
        },
        headStyles: {
          fillColor: navy,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
          valign: 'middle'
        },
        alternateRowStyles: { fillColor: lightTint },
        columnStyles: {
          0: { halign: 'center', cellWidth: 15 },
          1: { halign: 'center', cellWidth: 27 },
          2: { halign: 'left', cellWidth: 38 },
          3: { halign: 'right', cellWidth: 58 },
          4: { halign: 'right', cellWidth: 42 }
        },
        didDrawPage: drawTablePageHeader
      });

      let sectionTwoY = Math.max(pdf.lastAutoTable.finalY + 7, 35);
      if (sectionTwoY > pageHeight - 45) {
        pdf.addPage();
        sectionTwoY = 30;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(...navy);
      pdf.text('2. LEVEL RUNS & RESIDUALS ANALYSIS', margin, sectionTwoY);
      autoTable(pdf, {
        startY: sectionTwoY + 4,
        margin: { left: margin, right: margin, top: 25, bottom: 22 },
        head: [['Run ID', 'Path', 'Observed dH (m)', 'Residual V (mm)', 'Weight (P)', 'Status']],
        body: results.residuals.map((run) => [
          `#${run.id}`,
          '',
          run.dh.toFixed(4),
          run.v_mm.toFixed(4),
          run.weight.toFixed(4),
          run.isBlunder ? 'BLUNDER' : 'OK'
        ]),
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 8,
          textColor: darkText,
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
          cellPadding: 2.5
        },
        headStyles: {
          fillColor: navy,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
          valign: 'middle'
        },
        alternateRowStyles: { fillColor: lightTint },
        columnStyles: {
          0: { halign: 'center', cellWidth: 18 },
          1: { halign: 'center', cellWidth: 47 },
          2: { halign: 'right', cellWidth: 32 },
          3: { halign: 'right', cellWidth: 34 },
          4: { halign: 'right', cellWidth: 25 },
          5: { halign: 'center', cellWidth: 24 }
        },
        didDrawCell: (data) => {
          if (data.section !== 'body' || data.column.index !== 1) return;

          const run = results.residuals[data.row.index];
          if (!run) return;

          const centerY = data.cell.y + data.cell.height / 2;
          const arrowWidth = 4.5;
          const sidePadding = 1.8;
          const availableTextWidth = (data.cell.width - arrowWidth - sidePadding * 2) / 2;
          let fontSize = 8;
          pdf.setFont('helvetica', 'normal');
          while (fontSize > 5) {
            pdf.setFontSize(fontSize);
            if (Math.max(pdf.getTextWidth(run.from), pdf.getTextWidth(run.to)) <= availableTextWidth) break;
            fontSize -= 0.5;
          }
          pdf.setFontSize(fontSize);
          const baselineY = centerY + (fontSize / pdf.internal.scaleFactor) * 0.275;
          const fromWidth = pdf.getTextWidth(run.from);
          const toWidth = pdf.getTextWidth(run.to);
          const arrowCenterY = baselineY - (fontSize / 2.83465) * 0.35;
          const groupWidth = fromWidth + arrowWidth + toWidth + sidePadding * 2;
          const startX = data.cell.x + (data.cell.width - groupWidth) / 2;
          const lineStartX = startX + fromWidth + sidePadding;
          const lineEndX = lineStartX + arrowWidth;

          pdf.setTextColor(...darkText);
          pdf.text(run.from, startX, baselineY);
          pdf.text(run.to, lineEndX + sidePadding, baselineY);
          pdf.setDrawColor(...slate);
          pdf.setLineWidth(0.25);
          const arrowTipX = lineEndX - 0.35;
          const arrowBaseX = arrowTipX - 1.15;
          const arrowHeadHalfHeight = 0.65;
          pdf.line(lineStartX + 0.35, arrowCenterY, arrowTipX, arrowCenterY);
          pdf.line(arrowTipX, arrowCenterY, arrowBaseX, arrowCenterY - arrowHeadHalfHeight);
          pdf.line(arrowTipX, arrowCenterY, arrowBaseX, arrowCenterY + arrowHeadHalfHeight);
        },
        didDrawPage: drawTablePageHeader
      });

      const pageCount = pdf.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page++) {
        pdf.setPage(page);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...slate);
        pdf.text('Generated by RADAPHOHT Software', margin, pageHeight - margin);
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - margin, { align: 'right' });
      }

      pdf.save(`RADAPHOHT_Engineering_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      setErrorMsg(`PDF export failed: ${err.message}`);
    }
  };

  const handleAddBM = () => {
    setBenchmarks([...benchmarks, { id: `${Date.now()}-${Math.random()}`, name: '', elevation: '' }]);
  };
  const handleUpdateBM = (id, field, val) => {
    setBenchmarks(benchmarks.map(bm => bm.id === id ? { ...bm, [field]: val } : bm));
  };
  const handleDeleteBM = (id) => {
    setBenchmarks(benchmarks.filter(bm => bm.id !== id));
  };

  const handleAddRun = () => {
    setLevelRuns([...levelRuns, { id: `${Date.now()}-${Math.random()}`, from: '', to: '', dh: '', weightType: 'Direct (P)', weightVal: '1' }]);
  };
  const handleUpdateRun = (id, field, val) => {
    setLevelRuns(levelRuns.map(r => r.id === id ? { ...r, [field]: val } : r));
  };
  const handleDeleteRun = (id) => {
    setLevelRuns(levelRuns.filter(r => r.id !== id));
  };

  // --- LEAST SQUARES ENGINE ---
  const calculateAdjustment = () => {
    setErrorMsg('');
    setResults(null);
    setReportGeneratedAt('');

    try {
      const fixedBMs = {};
      benchmarks.forEach(b => {
        const name = b.name.trim();
        if (name && !isNaN(parseFloat(b.elevation))) {
          fixedBMs[name] = parseFloat(b.elevation);
        }
      });

      if (Object.keys(fixedBMs).length === 0) {
        setErrorMsg('Enter at least one valid known benchmark with an elevation.');
        return;
      }

      const validRuns = levelRuns
        .map((run, index) => ({ ...run, order: index + 1 }))
        .filter(r => r.from.trim() && r.to.trim() && !isNaN(parseFloat(r.dh)));
      if (validRuns.length === 0) {
        setErrorMsg('Enter at least one valid level run.');
        return;
      }

      const allStations = Array.from(new Set([
        ...Object.keys(fixedBMs),
        ...validRuns.flatMap(r => [r.from.trim(), r.to.trim()])
      ]));

      const unknowns = allStations.filter(st => !(st in fixedBMs));

      if (unknowns.length === 0) {
        setErrorMsg('No unknown stations were found to adjust.');
        return;
      }

      const numObs = validRuns.length;
      const numParams = unknowns.length;

      if (numObs < numParams) {
        setErrorMsg(`The number of observations (${numObs}) is less than the number of unknown stations (${numParams}).`);
        return;
      }

      const unknownIndexMap = {};
      unknowns.forEach((st, idx) => { unknownIndexMap[st] = idx; });

      const A = Array.from({ length: numObs }, () => Array(numParams).fill(0));
      const P = Array(numObs).fill(0);
      const L = Array(numObs).fill(0);

      validRuns.forEach((run, i) => {
        const from = run.from.trim();
        const to = run.to.trim();
        const dh = parseFloat(run.dh);

        let val = parseFloat(run.weightVal) || 1;
        if (run.weightType === 'Distance (km)' || run.weightType === 'Setup Count (k)') {
          P[i] = val > 0 ? 1 / val : 1;
        } else {
          P[i] = val > 0 ? val : 1;
        }

        let lVal = dh;
        if (from in fixedBMs) lVal += fixedBMs[from];
        if (to in fixedBMs) lVal -= fixedBMs[to];
        L[i] = lVal;

        if (to in unknownIndexMap) {
          A[i][unknownIndexMap[to]] = 1;
        }
        if (from in unknownIndexMap) {
          A[i][unknownIndexMap[from]] = -1;
        }
      });

      const N = Array.from({ length: numParams }, () => Array(numParams).fill(0));
      const U = Array(numParams).fill(0);

      for (let i = 0; i < numParams; i++) {
        for (let j = 0; j < numParams; j++) {
          let sum = 0;
          for (let k = 0; k < numObs; k++) {
            sum += A[k][i] * P[k] * A[k][j];
          }
          N[i][j] = sum;
        }

        let uSum = 0;
        for (let k = 0; k < numObs; k++) {
          uSum += A[k][i] * P[k] * L[k];
        }
        U[i] = uSum;
      }

      const N_inv = matrixInverse(N);
      if (!N_inv) {
        setErrorMsg('The normal matrix is singular. Check that the network is fully connected.');
        return;
      }

      const X = Array(numParams).fill(0);
      for (let i = 0; i < numParams; i++) {
        let sum = 0;
        for (let j = 0; j < numParams; j++) {
          sum += N_inv[i][j] * U[j];
        }
        X[i] = sum;
      }

      const V = Array(numObs).fill(0);
      let vtpv = 0;
      for (let k = 0; k < numObs; k++) {
        let ax = 0;
        for (let j = 0; j < numParams; j++) {
          ax += A[k][j] * X[j];
        }
        V[k] = ax - L[k];
        vtpv += P[k] * V[k] * V[k];
      }

      const dof = numObs - numParams;
      const s0 = dof > 0 ? Math.sqrt(vtpv / dof) : 0;

      const adjustedStations = allStations.map(st => {
        const isFixed = st in fixedBMs;
        const elev = isFixed ? fixedBMs[st] : X[unknownIndexMap[st]];
        let se = 0;
        if (!isFixed && dof > 0) {
          const varX = s0 * s0 * N_inv[unknownIndexMap[st]][unknownIndexMap[st]];
          se = varX > 0 ? Math.sqrt(varX) : 0;
        }
        return { station: st, isFixed, elev, se };
      });

      const residualList = validRuns.map((run, idx) => {
        const v_m = V[idx];
        const v_mm = v_m * 1000;
        const p = P[idx];
        const threshold = dof > 0 && s0 > 0 ? (2.5 * s0 / Math.sqrt(p)) : 0.01;
        const isBlunder = Math.abs(v_m) > threshold;

        return {
          id: run.order,
          from: run.from.trim(),
          to: run.to.trim(),
          dh: parseFloat(run.dh),
          v_mm: v_mm,
          weight: p,
          isBlunder
        };
      });

      setResults({
        s0,
        dof,
        vtpv,
        adjustedStations,
        residuals: residualList
      });
      setReportGeneratedAt(new Date().toLocaleString());

    } catch (err) {
      setErrorMsg('Calculation failed: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Hidden File Inputs */}
        <input type="file" ref={bmFileInput} onChange={handleImportBMCSV} accept=".csv" className="hidden" />
        <input type="file" ref={runFileInput} onChange={handleImportRunCSV} accept=".csv" className="hidden" />

        {/* Header Bar */}
        <header className="no-print border-b border-slate-800 pb-4 flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-cyan-400 tracking-wide">RADAPHOHT</h1>
            <p className="text-xs text-slate-400">Leveling Network Adjustment Software</p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={handleLoadSample}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
            >
              Load Example
            </button>
            {results && (
              <>
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition"
                >
                  Export CSV
                </button>
                <button
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg transition"
                >
                  Export Excel (.xlsx)
                </button>
                <button
                  onClick={handleExportPDF}
                  className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg transition"
                >
                  Export PDF Report
                </button>
              </>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
            >
              Settings
            </button>
          </div>
        </header>

        {settingsOpen && (
          <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}>
            <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="settings-title" className="text-sm font-bold uppercase tracking-wide text-cyan-400">SETTING</h2>
                <button onClick={() => setSettingsOpen(false)} aria-label="Close settings" className="px-2 text-slate-400 hover:text-white">✕</button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-slate-300">
                  <span>Confidence level</span>
                  <select value={settings.confidence} onChange={(event) => updateSetting('confidence', event.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
                    <option value="90">90%</option>
                    <option value="95">95%</option>
                    <option value="99">99%</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-slate-300">
                  <span>Decimal precision</span>
                  <select value={settings.precision} onChange={(event) => updateSetting('precision', Number(event.target.value))} className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
                    <option value="3">3 decimal places</option>
                    <option value="4">4 decimal places</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-slate-300 sm:col-span-2">
                  <span>Residual unit</span>
                  <select value={settings.residualUnit} onChange={(event) => updateSetting('residualUnit', event.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
                    <option value="mm">Millimeters (mm)</option>
                    <option value="m">Meters (m)</option>
                  </select>
                </label>
              </div>
              <div className="mt-5 flex justify-end">
                <button onClick={() => setSettingsOpen(false)} className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500">Done</button>
              </div>
            </section>
          </div>
        )}

        {results && (
          <div className="print-only mb-4">
            <h2 className="text-lg font-bold">RADAPHOHT — Survey Adjustment Report</h2>
            <p>Generated {reportGeneratedAt} · Confidence level: {settings.confidence}%</p>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Panel: Inputs */}
          <div className="no-print lg:col-span-7 space-y-6">
            
            {/* 1. Benchmarks */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                  1. KNOWN BENCHMARKS (FIXED)
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => bmFileInput.current.click()}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-800/60 text-xs font-medium rounded-lg transition"
                  >
                    Import CSV
                  </button>
                  <button
                    onClick={handleAddBM}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg transition"
                  >
                    + Add BM
                  </button>
                </div>
              </div>

              {/* Table Column Headers */}
              <div className="grid grid-cols-12 gap-2 px-2 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <div className="col-span-1">NO.</div>
                <div className="col-span-3">STATION ID</div>
                <div className="col-span-6">ELEVATION H <span className="normal-case">(m)</span></div>
                <div className="col-span-2 text-right">ACTION</div>
              </div>

              <div className="space-y-2">
                {benchmarks.map((bm, index) => (
                  <div
                    key={bm.id}
                    onMouseEnter={() => setHoveredStation(bm.name.trim() || null)}
                    onMouseLeave={() => setHoveredStation(null)}
                    className={`grid grid-cols-12 gap-2 items-center rounded-lg border p-2 transition-colors ${hoveredStation && bm.name.trim() === hoveredStation ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-800/60 bg-slate-950/40'}`}
                  >
                    <div className="col-span-1 text-center text-xs font-mono font-bold text-slate-400">
                      {index + 1}
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        placeholder="Station ID"
                        value={bm.name}
                        onChange={(e) => handleUpdateBM(bm.id, 'name', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div className="col-span-6">
                      <input
                        type="number"
                        step="any"
                        placeholder="Elevation Z (m)"
                        value={bm.elevation}
                        onChange={(e) => handleUpdateBM(bm.id, 'elevation', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div className="col-span-2 text-right">
                      <button
                        onClick={() => handleDeleteBM(bm.id)}
                        className="text-slate-500 hover:text-rose-400 text-xs px-2 py-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Level Runs */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                  2. LEVEL RUNS (OBSERVATIONS)
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => runFileInput.current.click()}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-800/60 text-xs font-medium rounded-lg transition"
                  >
                    Import CSV
                  </button>
                  <button
                    onClick={handleAddRun}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg transition"
                  >
                    + Add Run
                  </button>
                </div>
              </div>

              {/* Table Column Headers */}
              <div className="grid grid-cols-12 gap-2 px-2 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <div className="col-span-1 min-w-0">NO.</div>
                <div className="col-span-2 min-w-0">FROM</div>
                <div className="col-span-2 min-w-0">TO</div>
                <div className="col-span-2 min-w-0 whitespace-nowrap">ΔH <span className="normal-case">(m)</span></div>
                <div className="col-span-3 min-w-0 whitespace-nowrap">WEIGHT TYPE</div>
                <div className="col-span-1 min-w-0">VALUE</div>
                <div className="col-span-1 min-w-0 text-right whitespace-nowrap">ACTION</div>
              </div>

              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {levelRuns.map((run, index) => (
                  <div
                    key={run.id}
                    onMouseEnter={() => {
                      setHoveredStation(null);
                      setHoveredRunId(index + 1);
                    }}
                    onMouseLeave={() => setHoveredRunId(null)}
                    className={`grid grid-cols-12 gap-2 items-center rounded-lg border p-2 transition-colors ${hoveredRunId === index + 1 || hoveredStation && [run.from.trim(), run.to.trim()].includes(hoveredStation) ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-800/60 bg-slate-950/40'}`}
                  >
                    <div className="col-span-1 min-w-0 text-center text-xs font-mono font-bold text-slate-400">
                      {index + 1}
                    </div>
                    <div className="col-span-2 min-w-0">
                      <input
                        type="text"
                        placeholder="From"
                        value={run.from}
                        onChange={(e) => handleUpdateRun(run.id, 'from', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div className="col-span-2 min-w-0">
                      <input
                        type="text"
                        placeholder="To"
                        value={run.to}
                        onChange={(e) => handleUpdateRun(run.id, 'to', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div className="col-span-2 min-w-0">
                      <input
                        type="number"
                        step="any"
                        placeholder="ΔH (m)"
                        value={run.dh}
                        onChange={(e) => handleUpdateRun(run.id, 'dh', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div className="col-span-3 min-w-0">
                      <select
                        value={run.weightType}
                        onChange={(e) => handleUpdateRun(run.id, 'weightType', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                      >
                        <option value="Direct (P)">Direct (P)</option>
                        <option value="Distance (km)">Distance (km)</option>
                        <option value="Setup Count (k)">Setup Count (k)</option>
                      </select>
                    </div>
                    <div className="col-span-1 min-w-0">
                      <input
                        type="number"
                        step="any"
                        value={run.weightVal}
                        onChange={(e) => handleUpdateRun(run.id, 'weightVal', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div className="col-span-1 min-w-0 flex justify-end">
                      <button
                        onClick={() => handleDeleteRun(run.id)}
                        className="shrink-0 text-slate-500 hover:text-rose-400 text-xs px-0"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calculate Button & Error Banner */}
            <div className="space-y-3">
              <button
                onClick={calculateAdjustment}
                className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-sm rounded-xl shadow-lg transition active:scale-[0.99]"
              >
                COMPUTE ADJUSTMENT
              </button>

              {errorMsg && (
                <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 text-xs rounded-lg">
                  {errorMsg}
                </div>
              )}
            </div>

          </div>

          {/* Network diagram */}
          <div className="lg:col-span-5">
            <NetworkDiagram
              benchmarks={benchmarks}
              levelRuns={levelRuns}
              results={results}
              hoveredRunId={hoveredRunId}
              hoveredStation={hoveredStation}
              onHoverRun={setHoveredRunId}
              onHoverStation={setHoveredStation}
            />
          </div>
        </div>

        {/* Calculation Results */}
            {results && (
              <section className="space-y-4" aria-labelledby="results-title">
                <h2 id="results-title" className="sr-only">Calculation Results</h2>
                
                {/* Stats Summary */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl text-center">
                    <p className="min-h-7 text-[9px] leading-3 text-slate-400 uppercase font-semibold">Standard Error of Unit Weight (s₀)</p>
                    <p className="text-sm font-bold text-cyan-400 font-mono">
                        {results.s0.toFixed(settings.precision)}
                    </p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl text-center">
                    <p className="min-h-7 text-[9px] leading-3 text-slate-400 uppercase font-semibold">Redundancy (r)</p>
                    <p className="text-sm font-bold text-emerald-400 font-mono">{results.dof}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl text-center">
                    <p className="min-h-7 text-[9px] leading-3 text-slate-400 uppercase font-semibold">ΣPV²</p>
                    <p className="text-sm font-bold text-purple-400 font-mono">
                      {results.vtpv.toFixed(settings.precision)}
                    </p>
                  </div>
                </div>

                {/* Adjusted Elevations Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">
                    📍 Adjusted Station Elevations
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">No.</th>
                          <th className="pb-1.5 font-medium">Station ID</th>
                          <th className="pb-1.5 font-medium text-center">Status</th>
                          <th className="pb-1.5 font-medium text-right">H (m)</th>
                          <th className="pb-1.5 font-medium text-right">Std. Error (m)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {results.adjustedStations.map((st, index) => (
                          <tr key={st.station} className="hover:bg-slate-800/30">
                            <td className="py-1.5 pr-2 text-slate-500">{index + 1}</td>
                            <td className="py-1.5 font-bold text-slate-200">{st.station}</td>
                            <td className="py-1.5 text-center">
                              {st.isFixed ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">Fixed</span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">Adjusted</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right text-cyan-300 font-bold">{st.elev.toFixed(settings.precision)}</td>
                            <td className="py-1.5 text-right text-slate-400">{st.isFixed ? '-' : st.se.toFixed(settings.precision)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Residuals Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">
                    📊 Residuals & Blunder Detection
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="pb-1.5 font-medium">Run</th>
                          <th className="pb-1.5 font-medium">Path</th>
                          <th className="pb-1.5 font-medium text-right">V ({settings.residualUnit})</th>
                          <th className="pb-1.5 font-medium text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {results.residuals.map((r) => (
                          <tr
                            key={r.id}
                            onMouseEnter={() => {
                              setHoveredStation(null);
                              setHoveredRunId(r.id);
                            }}
                            onMouseLeave={() => setHoveredRunId(null)}
                            className={`${r.isBlunder ? 'bg-rose-950/20' : ''} ${hoveredRunId === r.id || hoveredStation && [r.from, r.to].includes(hoveredStation) ? 'bg-cyan-950/40' : 'hover:bg-slate-800/30'}`}
                          >
                            <td className="py-1.5 font-bold text-slate-400">#{r.id}</td>
                            <td className="py-1.5 text-slate-300">{r.from} → {r.to}</td>
                            <td className={`py-1.5 text-right font-bold ${r.isBlunder ? 'text-rose-400' : 'text-slate-200'}`}>
                              {(() => {
                                const residual = r.v_mm / 1000 * (settings.residualUnit === 'mm' ? 1000 : 1);
                                return residual > 0 ? `+${residual.toFixed(settings.precision)}` : residual.toFixed(settings.precision);
                              })()}
                            </td>
                            <td className="py-1.5 text-center align-middle">
                              {r.isBlunder ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 font-semibold">Blunder</span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </section>
            )}

      </div>
    </div>
  );
}