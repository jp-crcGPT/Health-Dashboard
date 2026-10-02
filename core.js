/* Health Baseline core: test catalogue, ranges, schedules and on-device report parsing.
   Runs in the browser and in Node (for tests). Nothing in this file touches the network or storage. */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';

  /* ---------------- Dates ---------------- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayISO = () => iso(new Date());
  function parseISO(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function isISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
    return iso(parseISO(s)) === s;
  }
  function addMonths(s, n) {
    const d = parseISO(s); const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  }
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 864e5); }
  function fmtDate(s) { if (!s) return ''; const d = parseISO(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtMonth(s) { const d = parseISO(s); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }

  /* ---------------- Numbers ---------------- */
  function round(v, dp) { const f = Math.pow(10, dp == null ? 2 : dp); return Math.round(v * f) / f; }
  function num(v, dp) {
    if (v == null || v === '' || isNaN(v)) return '';
    const r = dp == null ? +v : round(+v, dp);
    return String(r);
  }

  /* ---------------- Units ---------------- */
  const UNIT_LABEL = {
    'mg/dL': 'mg/dL', 'mmol/L': 'mmol/L', '%': '%', 'mmol/mol': 'mmol/mol', 'g/dL': 'g/dL', 'g/L': 'g/L',
    'fL': 'fL', 'x10^3/uL': '×10³/µL', '/uL': '/µL', 'lakh/uL': 'lakh/µL', 'ng/mL': 'ng/mL', 'nmol/L': 'nmol/L',
    'pg/mL': 'pg/mL', 'pmol/L': 'pmol/L', 'mIU/L': 'mIU/L', 'mIU/mL': 'mIU/mL', 'U/L': 'U/L', 'umol/L': 'µmol/L',
    'IU/mL': 'IU/mL', 'S/CO': 'S/CO', 'index': 'index', 'kg': 'kg', 'cm': 'cm', 'in': 'in', 'mmHg': 'mmHg',
    'mL/min': 'mL/min/1.73 m²'
  };
  const UNIT_RULES = [
    [/^mmol\/mol/, 'mmol/mol'],
    [/^mmol\/l/, 'mmol/L'],
    [/^(mg\/dl|mg\/100ml|mgs\/dl|mg%)/, 'mg/dL'],
    [/^umol\/l/, 'umol/L'],
    [/^nmol\/l/, 'nmol/L'],
    [/^pmol\/l/, 'pmol/L'],
    [/^(g\/dl|gm\/dl|gms\/dl|grams?\/dl|gm%|g%)/, 'g/dL'],
    [/^(g\/l|gm\/l)(?![a-z])/, 'g/L'],
    [/^(ng\/ml|ug\/l|mcg\/l)/, 'ng/mL'],
    [/^(pg\/ml|ng\/l)/, 'pg/mL'],
    [/^(uiu\/ml|miu\/l|mu\/l|uu\/ml|microiu\/ml|uiu\/ml)/, 'mIU/L'],
    [/^miu\/ml/, 'mIU/mL'],
    [/^iu\/ml/, 'IU/mL'],
    [/^(u\/l|iu\/l)(?![a-z])/, 'U/L'],
    [/^x?(10\^?3|10³|103|thou(sand)?s?|k)\/ul/, 'x10^3/uL'],
    [/^x?(10\^?9|10⁹|109)\/l/, 'x10^3/uL'],
    [/^(lakhs?|lacs?|10\^?5|10⁵)\/ul/, 'lakh/uL'],
    [/^(cells)?\/ul/, '/uL'],
    [/^(fl|femtolitres?|femtoliters?|cumicrons?|um3)(?![a-z])/, 'fL'],
    [/^(%|percent)/, '%'],
    [/^s\/co?(?![a-z])/, 'S/CO'],
    [/^(index|coi|cutoffindex)(?![a-z])/, 'index'],
    [/^kgs?(?![a-z])/, 'kg'],
    [/^(cms?|centimet(re|er)s?)(?![a-z])/, 'cm'],
    [/^(inch|inches|in)$/, 'in'],
    [/^mmhg/, 'mmHg'],
    [/^ml\/min/, 'mL/min']
  ];
  function canonUnit(raw) {
    if (!raw) return null;
    let s = String(raw).toLowerCase().replace(/[µμ]/g, 'u').replace(/\s+/g, '');
    s = s.replace(/\/(cu\.?mm|cumm|mm3|mm\^3|cmm)/g, '/ul').replace(/(cu\.?mm|cumm|mm\^3)/g, 'ul');
    for (const [re, u] of UNIT_RULES) if (re.test(s)) return u;
    return null;
  }
  const unitLabel = u => UNIT_LABEL[u] || u || '';

  /* ---------------- Range zones ---------------- */
  // A zone list covers the number line from left to right. Each zone: {max, incl, flag}. The last zone has max Infinity.
  const Z = (...segs) => segs.map(([max, incl, flag]) => ({ max, incl, flag }));
  function zoneFlag(zones, v) {
    for (const z of zones) if (z.incl ? v <= z.max : v < z.max) return z.flag;
    return zones[zones.length - 1].flag;
  }
  function labZones(lo, hi) {
    if (lo != null && hi != null && hi > lo) return Z([lo, false, 'out'], [hi, true, 'in'], [Infinity, false, 'out']);
    if (hi != null) return Z([hi, true, 'in'], [Infinity, false, 'out']);
    if (lo != null) return Z([lo, false, 'out'], [Infinity, false, 'in']);
    return null;
  }
  const FLAG_WORD = { in: 'In range', border: 'Borderline', out: 'Out of range', none: 'No range', info: '', done: 'Done' };
  function describeZones(zones, unit, dp) {
    const u = unit === '%' ? '%' : ' ' + unitLabel(unit);
    const step = Math.pow(10, -(dp == null ? 0 : dp));
    const parts = { in: [], border: [], out: [] };
    let lower = -Infinity, lowerIncl = false;
    for (const z of zones) {
      const lo = lower, hi = z.max;
      const hiShown = z.incl ? hi : round(hi - step, dp == null ? 0 : dp);
      let t;
      if (lo === -Infinity && hi === Infinity) t = 'any value';
      else if (lo === -Infinity) t = (z.incl ? 'up to ' + num(hi) : 'below ' + num(hi)) + u;
      else if (hi === Infinity) t = lowerIncl ? 'above ' + num(lo) + u : num(lo) + u + ' or more';
      else t = (lowerIncl ? 'over ' + num(lo) : num(lo)) + ' to ' + num(hiShown) + u;
      if (parts[z.flag]) parts[z.flag].push(t);
      lower = z.max; lowerIncl = z.incl;
    }
    const out = [];
    if (parts.in.length) out.push('In range: ' + parts.in.join(' or ') + '.');
    if (parts.border.length) out.push('Borderline: ' + parts.border.join(' or ') + '.');
    if (parts.out.length) out.push('Out of range: ' + parts.out.join(' or ') + '.');
    return out.join(' ');
  }

  /* ---------------- Test catalogue ---------------- */
  const QUAL_INFECTION = [['neg', 'Non-reactive', 'in'], ['pos', 'Reactive', 'out'], ['equiv', 'Indeterminate', 'border']];
  const QUAL_IMMUNITY = [['pos', 'Immune', 'in'], ['neg', 'Not immune', 'out'], ['equiv', 'Equivocal', 'border']];
  const QUAL_URINE = [['neg', 'Nil', 'in'], ['trace', 'Trace', 'border'], ['pos', 'Present', 'out']];

  const TESTS = {};
  function def(id, o) { o.id = id; o.aliases = o.aliases || []; o.excl = o.excl || []; TESTS[id] = o; }

  def('bp', {
    name: 'Blood pressure', short: 'BP', kind: 'bp', unit: 'mmHg', aliases: ['blood pressure', 'bp'],
    rangeText: 'In range: below 120/80. Borderline: 120 to 139 systolic or 80 to 89 diastolic. Out of range: 140/90 or higher.',
    source: 'European Society of Cardiology 2024. US guidelines (ACC/AHA) already call 130/80 and above high.'
  });
  def('weight', {
    name: 'Weight', short: 'Weight', kind: 'num', unit: 'kg', dp: 1, aliases: ['weight', 'body weight', 'wt'], excl: ['molecular', 'birth'],
    plaus: [20, 300], noFlag: true,
    source: 'Body mass index cut-off from the 2025 definition of obesity for Asian Indians (Lancet Diabetes & Endocrinology); underweight from WHO.'
  });
  def('waist', {
    name: 'Waist', short: 'Waist', kind: 'num', unit: 'cm', dp: 1, aliases: ['waist', 'waist circumference'], excl: ['hip', 'height'],
    plaus: [40, 200], conv: { in: v => v * 2.54 },
    zones: c => c.sex === 'F' ? Z([80, false, 'in'], [Infinity, false, 'out']) : Z([90, false, 'in'], [Infinity, false, 'out']),
    dom: c => c.sex === 'F' ? [55, 110] : [60, 120],
    source: 'Indian cut-off for belly fat: 90 cm for men, 80 cm for women (consensus for Asian Indians, kept in the 2025 definition).'
  });
  def('hb', {
    name: 'Haemoglobin', short: 'Hb', kind: 'num', unit: 'g/dL', dp: 1,
    aliases: ['haemoglobin', 'hemoglobin', 'hb', 'hgb', 'haemoglobin hb', 'hemoglobin hb', 'hb haemoglobin', 'hb hemoglobin', 'haemoglobin estimation', 'hemoglobin estimation', 'hb estimation'],
    excl: ['glyc', 'a1c', 'corpuscular', 'mean', 'concentration', 'electrophoresis', 'variant', 'urine', 'distribution', 'plasma free'],
    conv: { 'g/L': v => v / 10, 'mmol/L': v => v * 1.611 }, plaus: [3, 25],
    zones: c => {
      const low = c.sex === 'F' ? 12 : 13;
      const hi = c.hi != null && c.hi > low ? c.hi : (c.sex === 'F' ? 15 : 17);
      return Z([low, false, 'out'], [hi, true, 'in'], [Infinity, false, 'out']);
    },
    dom: c => c.sex === 'F' ? [8, 17] : [9, 19],
    source: 'Anaemia cut-off: WHO 2024 (below 13 g/dL for men, 12 for women). Upper limit from your lab, or a typical adult range.'
  });
  def('mcv', {
    name: 'Mean corpuscular volume (MCV)', short: 'MCV', kind: 'num', unit: 'fL', dp: 1, labRange: true,
    aliases: ['mcv', 'mean corpuscular volume', 'mean cell volume', 'mcv mean corpuscular volume'], excl: ['haemoglobin', 'hemoglobin', 'concentration'],
    plaus: [50, 130], fallback: () => [80, 100], dom: () => [65, 110],
    note: 'Small red cells (low MCV) can mean iron deficiency or thalassaemia trait.',
    source: 'Range from your lab, or a typical adult range of 80 to 100 fL.'
  });
  def('wbc', {
    name: 'White blood cells', short: 'WBC', kind: 'num', unit: 'x10^3/uL', dp: 1, labRange: true,
    aliases: ['total leucocyte count', 'total leukocyte count', 'tlc', 'total wbc count', 'wbc count', 'wbc', 'white blood cells', 'white blood cell count', 'total white blood cell count', 'leucocyte count', 'leukocyte count', 'total count', 'total leucocytes count', 'total leucocytes', 'wbc total count'],
    excl: ['differential', 'pus', 'urine', 'hpf', 'absolute'],
    conv: { '/uL': v => v / 1000, 'lakh/uL': v => v * 100 }, plaus: [0.5, 60], fallback: () => [4, 11], dom: () => [2, 14],
    source: 'Range from your lab, or a typical adult range of 4,000 to 11,000 per µL.'
  });
  def('plt', {
    name: 'Platelets', short: 'Platelets', kind: 'num', unit: 'x10^3/uL', dp: 0, labRange: true,
    aliases: ['platelet count', 'platelets', 'platelet', 'plt', 'platelet count plt', 'total platelet count'],
    excl: ['mean', 'volume', 'distribution', 'width', 'crit', 'pdw', 'mpv', 'large', 'lcr', 'pct', 'aggregat'],
    conv: { '/uL': v => v / 1000, 'lakh/uL': v => v * 100 }, plaus: [10, 1500], fallback: () => [150, 410], dom: () => [80, 500],
    source: 'Range from your lab, or a typical adult range of 1.5 to 4.1 lakh per µL.'
  });
  def('ferritin', {
    name: 'Ferritin', short: 'Ferritin', kind: 'num', unit: 'ng/mL', dp: 0,
    aliases: ['ferritin', 'serum ferritin', 's ferritin', 'ferritin serum'], plaus: [1, 5000],
    zones: c => Z([15, false, 'out'], [30, false, 'border'], [c.sex === 'F' ? 150 : 200, true, 'in'], [Infinity, false, 'out']),
    dom: c => [0, c.sex === 'F' ? 200 : 260],
    source: 'WHO 2020: below 15 means iron deficiency; above 150 (women) or 200 (men) needs a look. 15 to 29 is low iron stores.'
  });
  def('glucose_f', {
    name: 'Fasting glucose', short: 'Glucose', kind: 'num', unit: 'mg/dL', dp: 0,
    aliases: ['glucose fasting', 'fasting glucose', 'fasting blood glucose', 'fasting blood sugar', 'blood sugar fasting', 'fasting plasma glucose', 'plasma glucose fasting', 'glucose f', 'fbs', 'fbg', 'fpg', 'sugar fasting', 'blood glucose fasting', 'fasting sugar', 'glucose fasting plasma', 'plasma glucose f', 'glucose fasting fbs', 'fasting blood sugar fbs', 'glucose fasting f', 'fasting plasma glucose fpg'],
    excl: ['post', 'pp', 'random', 'average', 'estimated', 'urine', 'mean', 'prandial', 'hour', 'hr', 'rbs', 'ppbs', '2hr', 'challenge', 'tolerance'],
    conv: { 'mmol/L': v => v * 18.016 }, plaus: [40, 600],
    zones: () => Z([70, false, 'out'], [100, false, 'in'], [126, false, 'border'], [Infinity, false, 'out']),
    dom: () => [55, 160],
    source: 'American Diabetes Association: 100 to 125 is prediabetes, 126 or more suggests diabetes. Below 70 is low.'
  });
  def('hba1c', {
    name: 'HbA1c (3-month sugar average)', short: 'HbA1c', kind: 'num', unit: '%', dp: 1,
    aliases: ['hba1c', 'glycated haemoglobin', 'glycated hemoglobin', 'glycosylated haemoglobin', 'glycosylated hemoglobin', 'a1c', 'glyco hb', 'glycohemoglobin', 'glycohaemoglobin', 'glycated hb', 'glycosylated hb'],
    excl: ['average', 'estimated', 'eag', 'mean', 'abg'],
    conv: { 'mmol/mol': v => v / 10.929 + 2.15 }, plaus: [3, 20],
    zones: () => Z([5.7, false, 'in'], [6.5, false, 'border'], [Infinity, false, 'out']),
    dom: () => [4, 8],
    source: 'American Diabetes Association: 5.7 to 6.4% is prediabetes, 6.5% or more suggests diabetes.'
  });
  def('tc', {
    name: 'Total cholesterol', short: 'Total chol.', kind: 'num', unit: 'mg/dL', dp: 0,
    aliases: ['total cholesterol', 'cholesterol total', 'serum cholesterol', 'cholesterol', 's cholesterol', 'cholesterol serum', 'tc', 't cholesterol', 'cholesterol total serum'],
    excl: ['hdl', 'ldl', 'vldl', 'non', 'ester', 'remnant'],
    conv: { 'mmol/L': v => v * 38.67 }, plaus: [60, 600],
    zones: () => Z([200, false, 'in'], [240, false, 'border'], [Infinity, false, 'out']),
    dom: () => [110, 290],
    source: 'US National Cholesterol Education Program: below 200 desirable, 240 or more high.'
  });
  def('ldl', {
    name: 'LDL cholesterol', short: 'LDL', kind: 'num', unit: 'mg/dL', dp: 0,
    aliases: ['ldl cholesterol', 'ldl', 'ldl c', 'low density lipoprotein', 'low density lipoprotein cholesterol', 'ldl direct', 'direct ldl', 'ldl cholesterol direct', 'ldl calculated', 'ldl cholesterol calculated', 'cholesterol ldl', 'ldl chol'],
    excl: ['vldl', 'non', 'particle', 'small dense', 'sdldl'],
    conv: { 'mmol/L': v => v * 38.67 }, plaus: [10, 500],
    zones: () => Z([100, false, 'in'], [130, false, 'border'], [Infinity, false, 'out']),
    dom: () => [40, 200],
    source: 'Cardiological Society of India 2024: keep below 100 if you are at low risk. Lipid Association of India: treatment is considered from 130 at low risk.'
  });
  def('hdl', {
    name: 'HDL cholesterol', short: 'HDL', kind: 'num', unit: 'mg/dL', dp: 0,
    aliases: ['hdl cholesterol', 'hdl', 'hdl c', 'high density lipoprotein', 'high density lipoprotein cholesterol', 'hdl direct', 'direct hdl', 'hdl cholesterol direct', 'cholesterol hdl', 'hdl chol'],
    excl: ['non'],
    conv: { 'mmol/L': v => v * 38.67 }, plaus: [10, 150],
    zones: c => c.sex === 'F' ? Z([50, false, 'out'], [Infinity, false, 'in']) : Z([40, false, 'out'], [Infinity, false, 'in']),
    dom: () => [20, 100],
    source: 'US National Cholesterol Education Program: below 40 (men) or 50 (women) is low.'
  });
  def('tg', {
    name: 'Triglycerides', short: 'TG', kind: 'num', unit: 'mg/dL', dp: 0,
    aliases: ['triglycerides', 'triglyceride', 'tg', 'serum triglycerides', 'triglycerides tg', 'tgl', 's triglycerides', 'triglycerides serum'],
    conv: { 'mmol/L': v => v * 88.57 }, plaus: [20, 3000],
    zones: () => Z([150, false, 'in'], [200, false, 'border'], [Infinity, false, 'out']),
    dom: () => [40, 300],
    source: 'US National Cholesterol Education Program: below 150 normal, 200 or more high.'
  });
  def('nonhdl', {
    name: 'Non-HDL cholesterol', short: 'Non-HDL', kind: 'num', unit: 'mg/dL', dp: 0,
    aliases: ['non hdl cholesterol', 'non hdl', 'non hdl c', 'nonhdl', 'non hdl cholesterol calculated', 'nonhdl cholesterol', 'non hdl chol'],
    conv: { 'mmol/L': v => v * 38.67 }, plaus: [20, 500],
    zones: () => Z([130, false, 'in'], [160, false, 'border'], [Infinity, false, 'out']),
    dom: () => [60, 230],
    source: 'Cardiological Society of India 2024 and Lipid Association of India: below 130 at low risk. Calculated as total minus HDL if the lab does not report it.'
  });
  def('lpa', {
    name: 'Lipoprotein(a)', short: 'Lp(a)', kind: 'num', unit: 'mg/dL', altUnits: ['nmol/L'], dp: 1,
    aliases: ['lipoprotein a', 'lpa', 'lp a', 'lipoprotein little a', 'lipoprotein a serum'], plaus: [0, 1000],
    zones: c => c.unit === 'nmol/L'
      ? Z([75, false, 'in'], [125, true, 'border'], [Infinity, false, 'out'])
      : Z([30, false, 'in'], [50, true, 'border'], [Infinity, false, 'out']),
    dom: c => c.unit === 'nmol/L' ? [0, 250] : [0, 100],
    source: 'European Atherosclerosis Society 2022: below 30 mg/dL (75 nmol/L) is low risk; above 50 mg/dL (125 nmol/L) raises heart risk. Units can\'t be converted reliably, so the app keeps the lab\'s unit.'
  });
  def('alt', {
    name: 'ALT (SGPT)', short: 'ALT', kind: 'num', unit: 'U/L', dp: 0,
    aliases: ['alt', 'sgpt', 'alanine aminotransferase', 'alanine transaminase', 'alt sgpt', 'sgpt alt', 's g p t', 'alanine amino transferase'],
    plaus: [1, 3000],
    zones: c => {
      const acg = c.sex === 'F' ? 25 : 33;
      const labHi = c.hi != null ? c.hi : 40;
      return labHi > acg ? Z([acg, true, 'in'], [labHi, true, 'border'], [Infinity, false, 'out']) : Z([acg, true, 'in'], [Infinity, false, 'out']);
    },
    dom: () => [0, 80],
    source: 'American College of Gastroenterology 2017: healthy upper limit 33 U/L for men, 25 for women. Many labs use a higher limit; values between the two show as borderline.'
  });
  def('ast', {
    name: 'AST (SGOT)', short: 'AST', kind: 'num', unit: 'U/L', dp: 0, labRange: true,
    aliases: ['ast', 'sgot', 'aspartate aminotransferase', 'aspartate transaminase', 'ast sgot', 'sgot ast', 's g o t', 'aspartate amino transferase'],
    plaus: [1, 3000], fallback: () => [null, 40], dom: () => [0, 80],
    source: 'Range from your lab, or a common lab upper limit of 40 U/L.'
  });
  def('ggt', {
    name: 'GGT (gamma-glutamyl transferase)', short: 'GGT', kind: 'num', unit: 'U/L', dp: 0, labRange: true,
    aliases: ['ggt', 'gamma gt', 'gamma glutamyl transferase', 'gamma glutamyl transpeptidase', 'ggtp', 'gamma glutamyltransferase', 'g g t'],
    plaus: [1, 3000], dom: () => [0, 90],
    source: 'Range from your lab.'
  });
  def('creat', {
    name: 'Creatinine', short: 'Creatinine', kind: 'num', unit: 'mg/dL', dp: 2, labRange: true,
    aliases: ['creatinine', 'serum creatinine', 's creatinine', 'creatinine serum', 'creat', 'creatinine enzymatic'],
    excl: ['urine', 'clearance', 'albumin', 'acr', 'bun', 'kinase', 'cpk'],
    conv: { 'umol/L': v => v / 88.42 }, plaus: [0.2, 15], dom: c => c.sex === 'F' ? [0.3, 1.5] : [0.4, 1.7],
    source: 'Range from your lab. The app also works out eGFR (kidney filtering) from creatinine, age and sex.'
  });
  def('uric', {
    name: 'Uric acid', short: 'Uric acid', kind: 'num', unit: 'mg/dL', dp: 1, labRange: true,
    aliases: ['uric acid', 'serum uric acid', 's uric acid', 'uric acid serum', 'urate'], excl: ['urine'],
    conv: { 'umol/L': v => v / 59.48 }, plaus: [1, 20], fallback: c => [null, c.sex === 'F' ? 6 : 7], dom: () => [2, 10],
    source: 'Range from your lab, or the common high cut-offs of 7.0 (men) and 6.0 mg/dL (women).'
  });
  def('u_protein', {
    name: 'Urine protein', short: 'Urine protein', kind: 'qual', qualOnly: true, options: QUAL_URINE,
    aliases: ['urine protein', 'protein urine', 'urine albumin', 'albumin urine', 'protein', 'proteins', 'albumin', 'urinary protein', 'protein albumin'],
    excl: ['total', 'serum', 'globulin', 'c reactive', 'creactive', 'creatinine', 'ratio', 'micro', 'acr', '24'],
    source: 'Normal urine has no protein; trace or more is worth a repeat test and a doctor\'s look.'
  });
  def('u_sugar', {
    name: 'Urine sugar', short: 'Urine sugar', kind: 'qual', qualOnly: true, options: QUAL_URINE,
    aliases: ['urine sugar', 'urine glucose', 'sugar urine', 'glucose urine', 'sugar', 'glucose', 'urinary glucose', 'urine sugar fasting'],
    excl: ['fasting', 'post', 'pp', 'random', 'blood', 'plasma', 'serum', 'average', 'estimated', 'mean'],
    source: 'Normal urine has no sugar.'
  });
  def('tsh', {
    name: 'TSH (thyroid-stimulating hormone)', short: 'TSH', kind: 'num', unit: 'mIU/L', dp: 2, labRange: true,
    aliases: ['tsh', 'thyroid stimulating hormone', 'tsh ultrasensitive', 'ultrasensitive tsh', 'us tsh', 's tsh', 'tsh 3rd generation', 'third generation tsh', 'tsh ultra sensitive', 'ultra sensitive tsh', 'tsh serum', 'serum tsh', 'thyrotropin'],
    plaus: [0.005, 150], fallback: () => [0.4, 4.0], dom: () => [0, 7],
    source: 'Range from your lab, or about 0.4 to 4.0 (American Thyroid Association). If you take thyroid medicine and plan a pregnancy, the usual aim is below 2.5.'
  });
  def('vitd', {
    name: 'Vitamin D (25-OH)', short: 'Vit D', kind: 'num', unit: 'ng/mL', dp: 1,
    aliases: ['vitamin d', '25oh vitamin d', 'vitamin d 25oh', 'vitamin d total', '25 hydroxy vitamin d', '25oh vit d', 'vit d', '25oh d', 'total vitamin d', 'vitamin d 25 hydroxy', '25 hydroxyvitamin d', '25oh vitamin d total', 'vitamin d3', 'vitamin d 25oh total', 'vit d 25oh', '25oh vitamin d3'],
    excl: ['1 25', 'dihydroxy', '1 25oh'],
    conv: { 'nmol/L': v => v / 2.496 }, plaus: [2, 200],
    zones: () => Z([20, false, 'out'], [30, false, 'border'], [100, true, 'in'], [Infinity, false, 'out']),
    dom: () => [0, 110],
    source: 'Endocrine Society 2011 cut-offs (below 20 deficient, 20 to 29 insufficient). Its 2024 guideline advises against routine testing in healthy adults under 75.'
  });
  def('b12', {
    name: 'Vitamin B12', short: 'B12', kind: 'num', unit: 'pg/mL', dp: 0,
    aliases: ['vitamin b12', 'vit b12', 'b12', 'cyanocobalamin', 'cobalamin', 'vitamin b12 cyanocobalamin', 'serum vitamin b12', 'vitamin b12 serum'],
    conv: { 'pmol/L': v => v / 0.738 }, plaus: [50, 4000],
    zones: () => Z([200, false, 'out'], [300, false, 'border'], [Infinity, false, 'in']),
    dom: () => [100, 1100],
    source: 'British Society for Haematology 2014: below 200 pg/mL suggests deficiency; 200 to 299 is uncertain.'
  });
  def('hbsag', {
    name: 'Hepatitis B (HBsAg)', short: 'Hep B', kind: 'qual', options: QUAL_INFECTION, numericCut: 1, sense: 'below',
    aliases: ['hbsag', 'hbs ag', 'hepatitis b surface antigen', 'australia antigen', 'hepatitis b surface ag', 'hbsag elisa', 'hbsag rapid', 'hbsag cmia', 'hepatitis b virus surface antigen', 'hbsag screening'],
    excl: ['anti hbs', 'antibody', 'core', 'hbeag', 'dna', 'viral load', 'quantitative'],
    source: 'CDC 2023: test every adult for hepatitis B at least once.'
  });
  def('hcv', {
    name: 'Hepatitis C antibody', short: 'Hep C', kind: 'qual', options: QUAL_INFECTION, numericCut: 1, sense: 'below',
    aliases: ['anti hcv', 'hcv antibody', 'hcv', 'hepatitis c antibody', 'hepatitis c', 'anti hcv antibody', 'hcv ab', 'hepatitis c virus antibody', 'anti hcv total'],
    excl: ['rna', 'viral load', 'genotype', 'quantitative'],
    source: 'US Preventive Services Task Force 2020: test adults aged 18 to 79 once.'
  });
  def('hiv', {
    name: 'HIV 1 and 2', short: 'HIV', kind: 'qual', options: QUAL_INFECTION, numericCut: 1, sense: 'below',
    aliases: ['hiv', 'hiv 1 2', 'hiv i ii', 'hiv 1 and 2', 'hiv antibody', 'hiv 1 2 antibody', 'hiv i ii antibody', 'hiv duo', 'hiv combo', 'hiv ag ab', 'hiv 1 2 antibodies', 'human immunodeficiency virus', 'hiv i and ii', 'hiv 1 2 ag ab', 'hiv antibodies'],
    excl: ['rna', 'viral load', 'western', 'dna', 'cd4'],
    source: 'US Preventive Services Task Force 2019: test everyone aged 15 to 65 at least once.'
  });
  def('syphilis', {
    name: 'Syphilis (VDRL or RPR)', short: 'Syphilis', kind: 'qual', options: QUAL_INFECTION,
    aliases: ['vdrl', 'rpr', 'tpha', 'syphilis', 'treponema', 'treponema pallidum', 'vdrl rpr', 'syphilis antibody', 'vdrl test', 'rpr test', 'tp antibody'],
    source: 'Standard part of pre-pregnancy and pregnancy screening.'
  });
  def('bloodgroup', {
    name: 'Blood group', short: 'Group', kind: 'bloodgroup',
    aliases: ['blood group', 'abo group', 'abo grouping', 'abo typing', 'abo', 'blood group abo', 'abo blood group', 'blood grouping', 'blood group abo rh', 'abo rh', 'blood group and rh', 'blood group rh', 'blood group typing', 'abo and rh', 'blood group rh typing', 'abo rh d', 'blood group abo and rh'],
    source: 'Rhesus-negative mothers need extra care in pregnancy; the doctor plans it.'
  });
  def('hba2', {
    name: 'HbA2 (from HPLC)', short: 'HbA2', kind: 'num', unit: '%', dp: 1,
    aliases: ['hba2', 'haemoglobin a2', 'hemoglobin a2', 'a2', 'hba2 level'], plaus: [0.5, 15],
    zones: () => Z([3.5, true, 'in'], [Infinity, false, 'out']),
    dom: () => [1, 6],
    note: 'Low iron can lower HbA2 and hide a trait, so read it with ferritin.',
    source: 'Above 3.5% suggests beta-thalassaemia trait; a specialist confirms (National Health Mission, India, 2016).'
  });
  def('carrier', {
    name: 'Carrier test result', short: 'Carrier', kind: 'qual',
    options: [['normal', 'Not a carrier', 'in'], ['beta', 'Beta-thalassaemia carrier', 'out'], ['sickle', 'Sickle-cell carrier', 'out'], ['other', 'Other finding, see report', 'border']],
    source: 'Pick the lab\'s conclusion from the report.'
  });
  def('rubella', {
    name: 'Rubella IgG', short: 'Rubella', kind: 'qual', options: QUAL_IMMUNITY, numericCut: 10, sense: 'above', cutUnit: 'IU/mL',
    aliases: ['rubella igg', 'rubella antibody igg', 'anti rubella igg', 'rubella igg antibody', 'rubella igg antibodies', 'igg rubella', 'rubella virus igg', 'rubella igg antibody level'],
    excl: ['igm', 'avidity'],
    source: '10 IU/mL or more counts as immune for most tests; check the report\'s cut-off.'
  });
  def('varicella', {
    name: 'Chickenpox (varicella) IgG', short: 'Chickenpox', kind: 'qual', options: QUAL_IMMUNITY, numericCut: null, sense: 'above',
    aliases: ['varicella igg', 'varicella zoster igg', 'vzv igg', 'varicella zoster virus igg', 'chickenpox igg', 'igg varicella', 'varicella zoster antibody igg', 'vzv igg antibody', 'varicella zoster igg antibody'],
    excl: ['igm'],
    source: 'Cut-offs differ between tests; use the report\'s interpretation.'
  });
  def('pap', {
    name: 'Pap smear', short: 'Pap', kind: 'qual', options: [['normal', 'Normal (no abnormal cells)', 'in'], ['abnormal', 'Abnormal', 'out']],
    source: 'US Preventive Services Task Force 2018.'
  });
  def('hpv', {
    name: 'HPV test', short: 'HPV', kind: 'qual', options: [['neg', 'Negative', 'in'], ['pos', 'Positive', 'out']],
    aliases: ['hpv dna', 'high risk hpv', 'hr hpv', 'human papillomavirus', 'hpv test', 'hpv dna test', 'hpv high risk', 'hpv'],
    source: 'From age 30, an HPV test every 5 years is an option (US Preventive Services Task Force 2018).'
  });
  def('dental', { name: 'Dental check', short: 'Dental', kind: 'date' });
  def('eye', { name: 'Eye check', short: 'Eyes', kind: 'date' });

  /* ---------------- Panels and schedules ---------------- */
  const PANELS = [
    { id: 'vitals', name: 'Blood pressure, weight, waist', tests: ['bp', 'weight', 'waist'], mode: 'each',
      freq: { man: '1y', woman: '1y' }, plan: { months: 6 },
      why: 'High blood pressure and belly fat raise heart and diabetes risk early in Indians, usually without symptoms. Measure these at home or at any clinic.' },
    { id: 'cbc', name: 'Complete blood count', tests: ['hb', 'mcv', 'wbc', 'plt'], mode: 'any',
      freq: { man: '1y', woman: '1y' }, plan: { months: 6 },
      why: 'Checks for anaemia, infection and blood-cell problems. Small red cells (low MCV) can point to iron deficiency or thalassaemia trait.' },
    { id: 'iron', name: 'Iron stores (ferritin)', tests: ['ferritin'], mode: 'any',
      freq: { man: null, woman: '1y' }, plan: { months: 6 },
      why: 'Iron stores run low long before haemoglobin drops. Low iron is very common in Indian women and matters before pregnancy.' },
    { id: 'sugar', name: 'Blood sugar', tests: ['glucose_f', 'hba1c'], mode: 'any',
      freq: { man: '1y', woman: '3y' }, plan: { months: 6 },
      why: 'Catches prediabetes years before diabetes. HbA1c reflects your average sugar over about three months and needs no fasting.' },
    { id: 'lipids', name: 'Lipid profile', tests: ['tc', 'ldl', 'hdl', 'tg', 'nonhdl'], mode: 'any',
      freq: { man: '1y', woman: '5y' }, plan: null,
      why: 'Cholesterol builds up in arteries silently for decades, and Indians tend to get heart disease earlier. Fasting is not required (Cardiological Society of India 2024).' },
    { id: 'lpa', name: 'Lipoprotein(a)', tests: ['lpa'], mode: 'any',
      freq: { man: 'once', woman: 'once' }, plan: null,
      why: 'An inherited cholesterol particle that raises heart risk. It barely changes through life, so one test is enough (European Atherosclerosis Society 2022).' },
    { id: 'organ', name: 'Liver, kidney, urine', tests: ['alt', 'ast', 'ggt', 'creat', 'uric', 'u_protein', 'u_sugar'], mode: 'any',
      freq: { man: '1y', woman: '3y' }, plan: { months: 6, tests: ['u_protein', 'u_sugar'], name: 'Urine routine' },
      why: 'Liver enzymes flag fatty liver, which is common in Indians even at a normal weight. Creatinine and urine protein flag early kidney strain.' },
    { id: 'thyroid', name: 'Thyroid', tests: ['tsh'], mode: 'any',
      freq: { man: 'once', woman: '3y' }, plan: { months: 6 },
      why: 'An underactive or overactive thyroid causes tiredness, weight change and fertility problems. It is more common in women.' },
    { id: 'vits', name: 'Vitamin D and B12', tests: ['vitd', 'b12'], mode: 'any',
      freq: { man: 'optional', woman: 'optional' }, plan: { optional: true },
      why: 'Both are often low in India, B12 especially in vegetarians. Test if you have symptoms or a doctor suggests it.' },
    { id: 'infect', name: 'Hepatitis B, hepatitis C, HIV', tests: ['hbsag', 'hcv', 'hiv', 'syphilis'], planOnly: ['syphilis'], mode: 'each',
      freq: { man: 'once', woman: 'once' }, plan: { months: 12, name: 'Hepatitis B, hepatitis C, HIV, syphilis' },
      why: 'These infections can stay silent for years, and treatment works best early. One-time screening is recommended for every adult.' },
    { id: 'blood', name: 'Blood group', tests: ['bloodgroup'], mode: 'any',
      freq: { man: 'once', woman: 'once' }, plan: { any: true },
      why: 'Useful in an emergency. In pregnancy, a Rhesus-negative mother needs extra care, so the partner\'s group matters too.' },
    { id: 'carrier', name: 'Thalassaemia and sickle-cell carrier test', tests: ['hba2', 'carrier'], mode: 'any',
      freq: { man: null, woman: null }, plan: { any: true },
      why: 'Carriers are healthy, but if both parents carry a trait, a baby can inherit a serious blood disorder. Carriers are common in India, so test before pregnancy.' },
    { id: 'immunity', name: 'Rubella and chickenpox immunity', tests: ['rubella', 'varicella'], mode: 'each',
      freq: { man: null, woman: null }, plan: { immunity: true },
      why: 'Rubella or chickenpox during pregnancy can harm the baby. If you are not immune, get vaccinated and wait a month before trying (CDC).' },
    { id: 'cervical', name: 'Cervical screening', tests: ['pap', 'hpv'], mode: 'cervical',
      freq: { man: null, woman: 'cervical' }, plan: { cervical: true },
      why: 'Finds changes in the cervix years before cancer could develop.' },
    { id: 'vaccines', name: 'Vaccination review', tests: [], mode: 'vaccines',
      freq: { man: 'review', woman: 'review' }, plan: { vaccines: true },
      why: 'Adults often miss boosters. Mark what you have had and ask a doctor about anything you are unsure of.' },
    { id: 'dentaleye', name: 'Dental and eye check', tests: ['dental', 'eye'], mode: 'each',
      freq: { man: '1y', woman: '1y' }, plan: { months: 6, tests: ['dental'], name: 'Dental check' },
      why: 'Gum disease and eye problems are easier to fix early. Gum health matters more during pregnancy.' }
  ];
  const PANEL = Object.fromEntries(PANELS.map(p => [p.id, p]));
  const PANEL_OF = {};
  PANELS.forEach(p => p.tests.forEach(t => { PANEL_OF[t] = p.id; }));

  const VACCINES = [
    { id: 'td', name: 'Tetanus and diphtheria booster (Td or Tdap)', core: true, everyMonths: 120, note: () => 'Every 10 years.' },
    { id: 'hepb', name: 'Hepatitis B', core: true, note: () => 'Three doses, or immune on a blood test.' },
    { id: 'mmr', name: 'Measles, mumps and rubella (MMR)', core: true, note: () => 'Two doses, or immune on a blood test.' },
    { id: 'varicella', name: 'Chickenpox (varicella)', core: true, note: () => 'Two doses, or you have had chickenpox.' },
    { id: 'hpv', name: 'Human papillomavirus (HPV)', core: false, note: age => age == null ? 'Routine up to age 26; ages 27 to 45, decide with a doctor.' : age <= 26 ? 'Recommended up to age 26.' : age <= 45 ? 'At ' + age + ', this is a decision to make with a doctor.' : 'Not usually given after 45.' },
    { id: 'flu', name: 'Flu', core: false, note: () => 'Once a year, optional.' }
  ];
  const VACCINE_STATUS = [['done', 'Done or immune'], ['no', 'Not done'], ['unsure', 'Not sure']];

  const SKIP_TESTS = [
    { name: 'TORCH panel', text: 'A bundle of antibody tests (toxoplasma, rubella, cytomegalovirus, herpes) often sold for pregnancy planning. Obstetric guidelines, including ACOG\'s, advise against routine testing for toxoplasma, cytomegalovirus and herpes. Rubella immunity is the useful part, and it is already on your list.' },
    { name: 'AMH (anti-Müllerian hormone)', text: 'Often sold as a fertility test, but it does not predict the chance of natural conception. ACOG advises against using it that way for women who are not having fertility treatment (Committee Opinion 773, 2019).' }
  ];

  const SOURCES = [
    'American Diabetes Association, Standards of Care (prediabetes and diabetes cut-offs).',
    'Cardiological Society of India, 2024 dyslipidaemia guidelines; Lipid Association of India consensus statements.',
    'US National Cholesterol Education Program, ATP III (total cholesterol, HDL, triglycerides).',
    'European Atherosclerosis Society, 2022 consensus on lipoprotein(a).',
    'European Society of Cardiology, 2024 hypertension guideline; ACC/AHA 2017.',
    'Definition of obesity for Asian Indians, Lancet Diabetes & Endocrinology, 2025.',
    'WHO 2024 haemoglobin cut-offs for anaemia; WHO 2020 ferritin guideline.',
    'American College of Gastroenterology, 2017 guideline on abnormal liver tests.',
    'CKD-EPI 2021 creatinine equation for eGFR; KDIGO categories.',
    'American Thyroid Association (TSH range; pre-pregnancy target for people on treatment).',
    'Endocrine Society 2011 vitamin D cut-offs and 2024 guideline on testing.',
    'British Society for Haematology, 2014 guideline on cobalamin and folate.',
    'US Preventive Services Task Force: HIV (2019), hepatitis C (2020), cervical cancer (2018).',
    'CDC: hepatitis B screening (2023), MMR and chickenpox vaccines before pregnancy, folic acid.',
    'National Health Mission, India, 2016 guidelines on haemoglobinopathies.',
    'ACOG: caffeine in pregnancy; Committee Opinion 773 on AMH.'
  ];

  /* ---------------- Results helpers ---------------- */
  function history(state, p, testId) {
    return state.results.filter(r => r.p === p && r.t === testId).sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : (b.at || 0) - (a.at || 0)));
  }
  function latest(state, p, testId) { return history(state, p, testId)[0] || null; }
  function ageOn(profile, onDate) {
    if (!profile || profile.age == null || profile.age === '') return null;
    const asOf = profile.ageAsOf || onDate;
    return Number(profile.age) + Math.trunc(daysBetween(asOf, onDate) / 365.25);
  }
  function ctxFor(state, p, date) {
    const prof = state.profiles[p] || {};
    return { sex: prof.sex || 'M', age: ageOn(prof, date || todayISO()), heightCm: prof.heightCm || null };
  }

  /* ---------------- Evaluation ---------------- */
  function zonesFor(t, ctx, r) {
    const c = Object.assign({}, ctx, { lo: r ? r.lo : null, hi: r ? r.hi : null, unit: (r && r.u) || t.unit });
    if (t.zones) return { zones: t.zones(c), basis: 'guideline' };
    if (t.labRange) {
      const hasLab = r && (r.lo != null || r.hi != null);
      if (hasLab) return { zones: labZones(r.lo, r.hi), basis: 'lab' };
      const fb = t.fallback ? t.fallback(c) : null;
      if (fb) return { zones: labZones(fb[0], fb[1]), basis: 'typical' };
    }
    return { zones: null, basis: null };
  }
  function evaluate(testId, r, ctx) {
    const t = TESTS[testId];
    if (!t || !r) return { flag: 'none', word: '' };
    if (t.kind === 'bp') {
      const s = +r.v, d = +r.v2;
      const flag = (s >= 140 || d >= 90) ? 'out' : (s >= 120 || d >= 80) ? 'border' : 'in';
      return { flag, word: FLAG_WORD[flag], text: t.rangeText };
    }
    if (t.kind === 'qual') {
      const o = (t.options || []).find(x => x[0] === r.v);
      return o ? { flag: o[2], word: o[1] } : { flag: 'none', word: '' };
    }
    if (t.kind === 'bloodgroup') return { flag: 'info', word: r.v || '' };
    if (t.kind === 'date') return { flag: 'done', word: 'Done' };
    if (t.noFlag) return { flag: 'none', word: '' };
    const { zones, basis } = zonesFor(t, ctx, r);
    if (!zones) return { flag: 'none', word: FLAG_WORD.none, text: 'No range on the report. Add the lab\'s range to see a flag.' };
    const flag = zoneFlag(zones, +r.v);
    let text = describeZones(zones, r.u || t.unit, t.dp);
    if (basis === 'lab') text = 'Lab range. ' + text;
    if (basis === 'typical') text = 'Typical adult range (the report gave none). ' + text;
    return { flag, word: FLAG_WORD[flag], text, zones, basis };
  }
  function bmi(weightKg, heightCm) { if (!weightKg || !heightCm) return null; const m = heightCm / 100; return round(weightKg / (m * m), 1); }
  const BMI_ZONES = Z([18.5, false, 'out'], [23, true, 'in'], [Infinity, false, 'out']);
  function evaluateBmi(v) {
    const flag = zoneFlag(BMI_ZONES, v);
    return { flag, word: FLAG_WORD[flag], zones: BMI_ZONES, text: 'In range: 18.5 to 23. Out of range: below 18.5 (underweight) or above 23, which counts as obesity in the 2025 Indian definition.' };
  }
  // CKD-EPI 2021 (race-free) creatinine equation.
  function egfr(creatMgDl, age, sex) {
    if (!creatMgDl || age == null) return null;
    const female = sex === 'F';
    const k = female ? 0.7 : 0.9, a = female ? -0.241 : -0.302;
    const s = creatMgDl / k;
    const v = 142 * Math.pow(Math.min(s, 1), a) * Math.pow(Math.max(s, 1), -1.2) * Math.pow(0.9938, age) * (female ? 1.012 : 1);
    return Math.round(v);
  }
  const EGFR_ZONES = Z([60, false, 'out'], [90, false, 'border'], [Infinity, false, 'in']);
  function evaluateEgfr(v) {
    const flag = zoneFlag(EGFR_ZONES, v);
    return { flag, word: FLAG_WORD[flag], zones: EGFR_ZONES, text: 'In range: 90 or more. Borderline: 60 to 89 (often normal in healthy people). Out of range: below 60. Unit: mL/min/1.73 m².' };
  }
  function formatValue(testId, r) {
    const t = TESTS[testId];
    if (!t || !r) return '';
    if (t.kind === 'bp') return r.v + '/' + r.v2 + ' mmHg';
    if (t.kind === 'qual') { const o = (t.options || []).find(x => x[0] === r.v); return o ? o[1] : ''; }
    if (t.kind === 'bloodgroup') return r.v ? r.v.replace('+', ' positive').replace('-', ' negative') : '';
    if (t.kind === 'date') return 'Done';
    const u = r.u || t.unit;
    return (r.q ? r.q + ' ' : '') + num(r.v, t.dp) + (u === '%' ? '%' : ' ' + unitLabel(u));
  }

  /* ---------------- Schedules ---------------- */
  const FREQ_MONTHS = { '1y': 12, '3y': 36, '5y': 60 };
  function freqText(f, age) {
    switch (f) {
      case '1y': return 'Every year';
      case '3y': return 'Every 3 years';
      case '5y': return 'Every 4 to 6 years';
      case 'once': return 'Once';
      case 'optional': return 'Optional';
      case 'review': return 'Review once, then boosters as due';
      case 'cervical':
        if (age != null && age < 21) return 'From age 21';
        if (age != null && age >= 30) return 'HPV test every 5 years, or Pap smear every 3 years';
        return 'Pap smear every 3 years until 30';
      default: return '';
    }
  }
  function lastDate(state, p, testIds) {
    let d = null;
    for (const r of state.results) if (r.p === p && testIds.includes(r.t) && (!d || r.d > d)) d = r.d;
    return d;
  }
  const RANK = { due: 0, soon: 1, ok: 2, done: 2, optional: 3, na: 4 };
  function nextStatus(next, today, everDone) {
    if (!next || next <= today) return { state: 'due', text: everDone ? 'Due since ' + fmtMonth(next) : 'Not done yet' };
    if (daysBetween(today, next) <= 60) return { state: 'soon', text: 'Due ' + fmtMonth(next) };
    return { state: 'ok', text: 'Next ' + fmtMonth(next) };
  }
  function visibleTests(panel) { return panel.tests.filter(t => !(panel.planOnly || []).includes(t)); }
  function panelsFor(p, state) {
    const list = [];
    for (const pa of PANELS) {
      const f = pa.freq[p];
      if (f) list.push(pa);
      else if (p === 'man' && pa.id === 'carrier' && state.plan && state.plan.partner === 'man') list.push(pa);
    }
    return list;
  }
  function cervicalNext(state, p, today) {
    const age = ageOn(state.profiles[p], today);
    if (age != null && (age < 21 || age > 65)) return { na: true };
    const pap = latest(state, p, 'pap'), hpv = latest(state, p, 'hpv');
    const cands = [];
    if (pap) cands.push(addMonths(pap.d, 36));
    if (hpv && (age == null || age >= 30)) cands.push(addMonths(hpv.d, 60));
    if (!cands.length) return { next: null, ever: false };
    cands.sort();
    return { next: cands[cands.length - 1], ever: true };
  }
  function vaccineStatus(state, p, today) {
    const v = (state.vaccines && state.vaccines[p]) || {};
    const missing = VACCINES.filter(x => x.core && (!v[x.id] || v[x.id].s !== 'done'));
    if (missing.length) {
      const unsure = missing.filter(x => !v[x.id] || v[x.id].s === 'unsure').length;
      return { state: 'due', text: unsure ? 'Review needed' : missing.length + ' vaccine' + (missing.length > 1 ? 's' : '') + ' not done' };
    }
    const td = v.td;
    if (td && td.d) {
      const next = addMonths(td.d, 120);
      if (next <= today) return { state: 'due', text: 'Tetanus booster due' };
      return { state: 'done', text: 'Reviewed. Tetanus booster ' + fmtMonth(next) };
    }
    return { state: 'done', text: 'Reviewed' };
  }
  function schedule(panel, p, state, today) {
    const f = panel.freq[p];
    const age = ageOn(state.profiles[p], today);
    if (!f) {
      if (panel.id === 'carrier') {
        const done = lastDate(state, p, panel.tests);
        return done ? { state: 'done', text: 'Done', freq: 'For pregnancy planning' } : { state: 'due', text: 'Partner test for pregnancy planning', freq: 'Once, before pregnancy' };
      }
      return { state: 'na', text: '' };
    }
    const freq = freqText(f, age);
    if (f === 'optional') { const d = lastDate(state, p, panel.tests); return { state: 'optional', text: d ? 'Last ' + fmtMonth(d) : 'Optional', freq }; }
    if (f === 'review') return Object.assign(vaccineStatus(state, p, today), { freq });
    if (f === 'cervical') {
      const c = cervicalNext(state, p, today);
      if (c.na) return { state: 'na', text: age < 21 ? 'From age 21' : 'Usually stops after 65', freq };
      return Object.assign(nextStatus(c.next, today, c.ever), { freq });
    }
    const tests = visibleTests(panel);
    if (f === 'once') {
      const missing = tests.filter(t => !latest(state, p, t));
      if (panel.mode === 'each' ? missing.length === 0 : missing.length < tests.length) return { state: 'done', text: 'Done', freq };
      return { state: 'due', text: panel.mode === 'each' && missing.length < tests.length ? missing.length + ' of ' + tests.length + ' still to do' : 'Not done yet', freq };
    }
    const months = FREQ_MONTHS[f];
    if (panel.mode === 'each') {
      let worst = null;
      for (const t of tests) {
        const r = latest(state, p, t);
        const st = nextStatus(r ? addMonths(r.d, months) : null, today, !!r);
        if (!worst || RANK[st.state] < RANK[worst.state]) worst = st;
      }
      const never = tests.filter(t => !latest(state, p, t)).length;
      if (worst.state === 'due' && never > 0 && never < tests.length) worst = { state: 'due', text: never + ' of ' + tests.length + ' not done yet' };
      return Object.assign(worst, { freq });
    }
    const d = lastDate(state, p, tests);
    return Object.assign(nextStatus(d ? addMonths(d, months) : null, today, !!d), { freq });
  }

  /* ---------------- Pregnancy planning ---------------- */
  function partnerKey(state) { return state.plan && state.plan.partner === 'man' ? 'man' : 'partner'; }
  function planRef(state, today) { const T = state.plan && state.plan.target; return T && T >= today ? T : today; }
  function planTests(panel) { return (panel.plan && panel.plan.tests) || panel.tests; }
  function planStatus(panel, p, state, today) {
    const pl = panel.plan; if (!pl) return null;
    const ref = planRef(state, today);
    if (pl.optional) { const d = lastDate(state, p, panel.tests); return { state: 'optional', text: d ? 'Optional. Last ' + fmtMonth(d) : 'Optional' }; }
    if (pl.vaccines) { const v = vaccineStatus(state, p, today); return { state: v.state === 'done' ? 'ok' : 'needed', text: v.state === 'done' ? 'Reviewed' : v.text }; }
    if (pl.cervical) {
      const c = cervicalNext(state, p, today);
      if (c.na) return { state: 'ok', text: 'Not needed at this age' };
      if (!c.next || c.next <= ref) return { state: 'needed', text: c.ever ? 'Due before your start date' : 'Not done yet' };
      return { state: 'ok', text: 'Up to date. Next ' + fmtMonth(c.next) };
    }
    if (pl.immunity) {
      const vac = (state.vaccines && state.vaccines[p]) || {};
      const parts = [];
      let st = 'ok';
      for (const [tid, vid, label] of [['rubella', 'mmr', 'Rubella'], ['varicella', 'varicella', 'Chickenpox']]) {
        const r = latest(state, p, tid);
        if (r && r.v === 'pos') parts.push(label + ': immune');
        else if (r && (r.v === 'neg' || r.v === 'equiv')) { parts.push(label + ': vaccinate, then wait a month'); st = 'action'; }
        else if (vac[vid] && vac[vid].s === 'done') parts.push(label + ': vaccinated');
        else { parts.push(label + ': test needed'); if (st !== 'action') st = 'needed'; }
      }
      return { state: st, text: parts.join('. ') };
    }
    const tests = planTests(panel);
    if (pl.any) {
      return lastDate(state, p, tests) ? { state: 'ok', text: 'Done' } : { state: 'needed', text: 'Not done yet' };
    }
    const from = addMonths(ref, -pl.months);
    const dates = tests.map(t => { const r = latest(state, p, t); return r ? r.d : null; });
    const fresh = d => d && d >= from;
    const okAll = panel.mode === 'each' ? dates.every(fresh) : dates.some(fresh);
    if (okAll) return { state: 'ok', text: 'Current' };
    const any = dates.some(Boolean);
    return any ? { state: 'repeat', text: 'Repeat within ' + pl.months + ' months of your start date' } : { state: 'needed', text: 'Not done yet' };
  }
  function partnerStatus(panelId, state, today) {
    const pk = partnerKey(state);
    const woman = panelId === 'blood' ? latest(state, 'woman', 'bloodgroup') : latest(state, 'woman', 'carrier');
    const done = lastDate(state, pk, PANEL[panelId].tests);
    if (panelId === 'blood') {
      const rhNeg = woman && /-$/.test(woman.v || '');
      if (done) return { state: 'ok', text: 'Done' };
      return rhNeg ? { state: 'needed', text: 'Needed: she is Rhesus negative' } : { state: 'needed', text: 'Not done yet' };
    }
    const carrier = woman && ['beta', 'sickle', 'other'].includes(woman.v);
    if (done) return { state: 'ok', text: 'Done' };
    return carrier ? { state: 'needed', text: 'Important: she is a carrier' } : { state: 'needed', text: 'Recommended before pregnancy' };
  }
  const PLAN_PANELS = ['vitals', 'cbc', 'iron', 'sugar', 'organ', 'thyroid', 'infect', 'blood', 'carrier', 'immunity', 'cervical', 'vaccines', 'dentaleye', 'vits'];
  function timeline(state, today) {
    const T = state.plan && state.plan.target;
    if (!T) return null;
    const imm = planStatus(PANEL.immunity, 'woman', state, today);
    const items = [
      { key: 'visit', text: 'See a doctor for a pre-pregnancy check-up', by: addDays(T, -90) },
      { key: 'folic', text: 'Start folic acid, 400 micrograms a day', note: 'At least 1 month before trying; many doctors advise 3. A doctor may suggest a higher dose in some situations (CDC, WHO).', by: addDays(T, -90) },
      { key: 'meds', text: 'Review regular medicines and supplements with the doctor', by: addDays(T, -90) },
      { key: 'tests', text: 'Finish the tests listed below', by: addDays(T, -60), auto: true },
      { key: 'partner', text: 'Partner\'s blood group and carrier test', by: addDays(T, -60), auto: true },
      { key: 'vaccines', text: 'Vaccines if not immune, with the last dose at least 1 month before trying', note: 'Chickenpox vaccine needs 2 doses, 4 to 8 weeks apart, so start early.', by: addDays(T, -30), hidden: imm && imm.state === 'ok' },
      { key: 'lifestyle', text: 'Stop smoking and alcohol, and keep caffeine under 200 mg a day', note: 'Caffeine limit for pregnancy from ACOG; about two cups of regular coffee.', by: T },
      { key: 'start', text: 'Start trying', by: T, final: true }
    ];
    return items.filter(i => !i.hidden);
  }

  /* ---------------- Report parsing ---------------- */
  const IGNORE = ['vldl', 'vldl cholesterol', 'estimated average glucose', 'eag', 'average blood glucose', 'mean blood glucose', 'abg', 'mean plasma glucose',
    'egfr', 'estimated gfr', 'gfr', 'mch', 'mchc', 'rdw', 'rdw cv', 'rdw sd', 'mpv', 'pdw', 'pct', 'plateletcrit', 'p lcr', 'hct', 'pcv', 'packed cell volume',
    'haematocrit', 'hematocrit', 'rbc count', 'total rbc', 'rbc', 'red blood cell count', 'red blood cells', 'hba', 'hbf', 'hbs', 'hbc', 'hbd', 'hbe', 'hb a0', 'anti hbs', 'hbs antibody',
    'bilirubin', 'total bilirubin', 'direct bilirubin', 'indirect bilirubin', 'bilirubin total', 'bilirubin direct', 'bilirubin indirect', 'serum albumin', 'albumin serum', 'globulin',
    'total protein', 'total proteins', 'protein total', 'alkaline phosphatase', 'alp', 'bun', 'blood urea nitrogen', 'urea', 'blood urea', 'serum urea', 'calcium', 'sodium', 'potassium',
    'chloride', 'phosphorus', 'magnesium', 'free t3', 'free t4', 't3', 't4', 'ft3', 'ft4', 'total t3', 'total t4', 'hs crp', 'crp', 'c reactive protein', 'homocysteine', 'apolipoprotein',
    'apo a1', 'apo b', 'apolipoprotein b', 'apolipoprotein a1', 'insulin', 'iron', 'serum iron', 'tibc', 'transferrin', 'transferrin saturation', 'uibc', 'folate', 'folic acid', 'esr',
    'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils', 'absolute', 'specific gravity', 'ph', 'colour', 'color', 'appearance', 'ketone', 'ketones', 'ketone bodies',
    'bile salts', 'bile pigments', 'urobilinogen', 'nitrite', 'leucocyte esterase', 'pus cells', 'epithelial cells', 'casts', 'crystals', 'bacteria', 'rbcs', 'mucus', 'yeast',
    'amorphous', 'deposits', 'volume', 'reaction', 'clarity', 'transparency', 'blood', 'occult blood', 'hdl ldl', 'cholesterol hdl ratio', 'immature granulocytes', 'nrbc'];
  const RH_ALIASES = ['rh type', 'rh typing', 'rh factor', 'rh d', 'rh d typing', 'rh d type', 'rhesus', 'rh', 'rh d factor', 'rh grouping', 'rho d', 'rhesus factor', 'rh d antigen'];

  function prenorm(s) {
    return String(s)
      .replace(/\+\s*ve\b/gi, ' positive ')
      .replace(/(^|[\s(])[-−–—]\s*ve\b/gi, '$1 negative ')
      .replace(/(\d)\s*\+\s*(\d)/g, '$1 $2');
  }
  function norm(s) {
    let t = prenorm(s).toLowerCase().replace(/[µμ]/g, 'u').replace(/β/g, 'beta');
    t = t.replace(/vitamin\s*-?\s*b\s*-?\s*12/g, 'vitamin b12').replace(/\bvit\.?\s*-?\s*b\s*-?\s*12/g, 'vit b12').replace(/\bb\s*-\s*12\b/g, 'b12');
    t = t.replace(/\bhb\s*-?\s*a\s*-?\s*1\s*-?\s*c\b/g, 'hba1c');
    t = t.replace(/\bhb\s*-?\s*a\s*-?\s*2\b/g, 'hba2');
    t = t.replace(/\bhb\s*-?\s*([sfcde])\b/g, 'hb$1');
    t = t.replace(/\bhb\s*-?\s*a\s*0\b/g, 'hb a0');
    t = t.replace(/\blp\s*\(\s*a\s*\)/g, 'lpa').replace(/lipoprotein\s*\(\s*a\s*\)/g, 'lipoprotein a');
    t = t.replace(/\b25\s*-?\s*\(?\s*oh\s*\)?/g, '25oh ');
    t = t.replace(/[^a-z0-9%+]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t;
  }
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let ALIASES = null;
  function aliasList() {
    if (ALIASES) return ALIASES;
    const list = [];
    for (const t of Object.values(TESTS)) for (const a of t.aliases) list.push({ a: norm(a), test: t.id });
    for (const a of IGNORE) list.push({ a: norm(a), test: '_ignore' });
    for (const a of RH_ALIASES) list.push({ a: norm(a), test: '_rh' });
    const seen = new Set();
    ALIASES = list.filter(x => x.a && !seen.has(x.a + '|' + x.test) && seen.add(x.a + '|' + x.test))
      .sort((x, y) => y.a.length - x.a.length)
      .map(x => Object.assign(x, { re: new RegExp('(?:^| )' + escRe(x.a) + '(?= |$)') }));
    return ALIASES;
  }
  const exclRe = {};
  function excluded(testId, n) {
    const t = TESTS[testId]; if (!t || !t.excl.length) return false;
    return t.excl.some(e => { const k = testId + '|' + e; exclRe[k] = exclRe[k] || new RegExp('(?:^| )' + escRe(norm(e))); return exclRe[k].test(n); });
  }
  function matchAlias(labelText, learned) {
    const n = norm(labelText);
    if (!n) return null;
    if (learned && learned[n]) return { test: learned[n], a: n, learned: true, n };
    if (/(?:^| )ratio(?= |$)/.test(n)) return { test: '_ignore', a: 'ratio', n };
    for (const x of aliasList()) {
      if (x.re.test(n) && !excluded(x.test, n)) return { test: x.test, a: x.a, n };
    }
    return null;
  }

  const NUM_RE = /^([<>≤≥]=?)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/;
  const QUAL_PATTERNS = [
    ['neg', /\bnon ?reactive\b|\bnegative\b|\bnot detected\b|\bundetected\b|\babsent\b|\bnil\b|\bneg\b|\bnon ?immune\b|\bnot immune\b|\bnormal\b/],
    ['pos', /(?<!\bnon ?)\breactive\b|(?<!\bnon ?)\bpositive\b|(?<!\bnot )\bdetected\b|\bpresent\b|\bpos\b|(?<!\bnon ?)(?<!\bnot )\bimmune\b|(?:^| )\+{1,4}(?= |$)/],
    ['trace', /\btrace\b/],
    ['equiv', /\bequivocal\b|\bborderline\b|\bindeterminate\b|\bgr[ae]y zone\b|\binconclusive\b/]
  ];
  function qualCode(text) {
    let best = null;
    for (const [code, re] of QUAL_PATTERNS) {
      const m = re.exec(text);
      if (m && (!best || m.index < best.i)) best = { i: m.index, code };
    }
    return best ? best.code : null;
  }
  const toNum = s => parseFloat(String(s).replace(/,/g, ''));
  function parseValueCell(text) {
    const t = String(text).trim();
    const m = t.match(NUM_RE);
    if (!m) return null;
    let rest = t.slice(m[0].length).trim();
    if (/^(-|–|—|to\b|:|\/\s*\d|\.\d)/i.test(rest)) return null;
    rest = rest.replace(/^(\*+|\(?[hl]\)?(?![a-z])|high\b|low\b|↑|↓)\s*/i, '').trim();
    const q = m[1] ? m[1][0] : null;
    const v = toNum(m[2]);
    if (!rest) return { q, v, unit: null, rest: '' };
    const u = unitPrefix(rest);
    if (u) return { q, v, unit: u.unit, rest: u.rest };
    if (/^[<>≤≥(\[]|^\d/.test(rest)) return { q, v, unit: null, rest };
    if (qualCode(norm(rest))) return { q, v, unit: null, rest };
    return null;
  }
  function unitPrefix(text) {
    const toks = String(text).trim().split(/\s+/);
    for (let k = Math.min(3, toks.length); k >= 1; k--) {
      const u = canonUnit(toks.slice(0, k).join(''));
      if (u) {
        // Make sure the unit doesn't swallow the start of a range like "10^3/uL 4-10"
        return { unit: u, rest: toks.slice(k).join(' ') };
      }
    }
    return null;
  }
  function parseRange(text, sex) {
    let t = String(text || '').replace(/(\d),(?=\d)/g, '$1');
    if (sex && /\b(fe)?males?\b/i.test(t)) {
      const re = sex === 'F' ? /\bfemales?\b/i : /(?<!fe)\bmales?\b/i;
      const m = re.exec(t);
      if (m) t = t.slice(m.index + m[0].length);
    }
    const cands = [];
    let m;
    if ((m = /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i.exec(t))) cands.push({ i: m.index, lo: +m[1], hi: +m[2] });
    if ((m = /(?:<=?|≤|less than|below|upto|up to|till)\s*(\d+(?:\.\d+)?)/i.exec(t))) cands.push({ i: m.index, lo: null, hi: +m[1] });
    if ((m = /(?:>=?|≥|more than|above|greater than|over)\s*(\d+(?:\.\d+)?)/i.exec(t))) cands.push({ i: m.index, lo: +m[1], hi: null });
    if (!cands.length) return null;
    cands.sort((a, b) => a.i - b.i);
    const c = cands[0];
    if (c.lo != null && c.hi != null && c.hi < c.lo) return null;
    return { lo: c.lo, hi: c.hi };
  }

  function buildLines(pages) {
    const lines = [];
    pages.forEach((items, pi) => {
      const its = [];
      for (const it of items) {
        if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
        const h = it.h || 10;
        // Split items that use runs of spaces for column alignment.
        const parts = it.str.split(/(\s{3,})/);
        if (parts.length > 1 && it.w) {
          const cw = it.w / it.str.length;
          let x = it.x;
          for (const part of parts) {
            if (part.trim()) its.push({ str: part.trim(), x, y: it.y, w: cw * part.length, h });
            x += cw * part.length;
          }
        } else its.push({ str: it.str, x: it.x, y: it.y, w: it.w || it.str.length * h * 0.5, h });
      }
      its.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      const pageLines = [];
      for (const it of its) {
        const tol = Math.max(2, it.h * 0.45);
        let line = null;
        for (const l of pageLines) if (Math.abs(l.y - it.y) <= tol) { line = l; break; }
        if (!line) { line = { y: it.y, items: [] }; pageLines.push(line); }
        line.items.push(it);
      }
      pageLines.sort((a, b) => b.y - a.y);
      for (const l of pageLines) {
        l.items.sort((a, b) => a.x - b.x);
        const cells = [];
        let cur = null, prevEnd = null;
        for (const it of l.items) {
          const gap = prevEnd == null ? 0 : it.x - prevEnd;
          const thr = Math.max(4, it.h * 0.9);
          // A big gap, or text that overlaps the previous run (a column collision), starts a new cell.
          if (!cur || gap > thr || gap < -Math.max(1, it.h * 0.15)) { cur = { text: it.str, x: it.x }; cells.push(cur); }
          else cur.text += (gap > it.h * 0.1 ? ' ' : '') + it.str;
          prevEnd = Math.max(prevEnd == null ? 0 : prevEnd, it.x + it.w);
        }
        const kept = cells.map(c => ({ text: c.text.replace(/\s+/g, ' ').trim(), x: c.x })).filter(c => c.text);
        if (kept.length) lines.push({ page: pi, y: l.y, cells: kept, text: kept.map(c => c.text).join('   ') });
      }
    });
    return lines;
  }
  function firstValueCell(cells) {
    for (let j = 0; j < cells.length; j++) if (parseValueCell(cells[j].text)) return j;
    return -1;
  }
  // When a long method name runs into the value column ("IMMUNOTURBIDIMETRY 38.2" then "mg/dL"),
  // split the trailing number into its own cell. Only done when a unit confirms it.
  const TRAIL_NUM = '([<>≤≥]?\\s*(?:\\d{1,3}(?:,\\d{2,3})+|\\d+)(?:\\.\\d+)?)';
  const TRAIL_WITH_UNIT = new RegExp('^(.*[a-z)\\]])\\s+' + TRAIL_NUM + '\\s+(\\S+(?:\\s\\S+)?)$', 'i');
  const TRAIL_ONLY = new RegExp('^(.*[a-z)\\]])\\s+' + TRAIL_NUM + '$', 'i');
  function splitMerged(cells) {
    const out = [];
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      if (!parseValueCell(c.text)) {
        let m = TRAIL_WITH_UNIT.exec(c.text);
        if (m && canonUnit(m[3])) { out.push({ text: m[1], x: c.x }, { text: m[2] + ' ' + m[3], x: c.x }); continue; }
        m = TRAIL_ONLY.exec(c.text);
        const nx = cells[j + 1];
        if (m && nx && canonUnit(nx.text)) { out.push({ text: m[1], x: c.x }, { text: m[2], x: c.x }); continue; }
      }
      out.push(c);
    }
    return out;
  }

  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function findDates(text) {
    const t = String(text).toLowerCase();
    const out = [];
    let m;
    const re1 = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
    while ((m = re1.exec(t))) out.push({ i: m.index, d: +m[1], mo: +m[2], y: +m[3] });
    const re2 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.,]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-\/.,']*(\d{2,4})\b/g;
    while ((m = re2.exec(t))) out.push({ i: m.index, d: +m[1], mo: MON[m[2]], y: +m[3] });
    const re3 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-]+(\d{4})\b/g;
    while ((m = re3.exec(t))) out.push({ i: m.index, d: +m[2], mo: MON[m[1]], y: +m[3] });
    const re4 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = re4.exec(t))) out.push({ i: m.index, d: +m[3], mo: +m[2], y: +m[1] });
    return out.map(x => {
      const y = x.y < 100 ? 2000 + x.y : x.y;
      const s = y + '-' + pad(x.mo) + '-' + pad(x.d);
      return isISO(s) ? { i: x.i, s } : null;
    }).filter(Boolean).sort((a, b) => a.i - b.i);
  }
  function detectDate(lines, today) {
    const prio = [/collect/, /sample (date|drawn|received)|drawn/, /regist|receiv|booking|accession/, /report|released|authori[sz]ed|approved|printed/];
    let best = null;
    for (const L of lines) {
      const n = L.text.toLowerCase();
      if (/\b(dob|d\.o\.b|date of birth|birth)\b/.test(n)) continue;
      const ds = findDates(L.text).filter(d => d.s <= addDays(today, 1) && d.s >= '2000-01-01');
      if (!ds.length) continue;
      let rank = prio.findIndex(re => re.test(n));
      if (rank < 0) rank = 9;
      let pick = ds[0];
      if (rank < 9) {
        const kw = n.search(prio[rank]);
        const after = ds.find(d => d.i >= kw);
        if (after) pick = after;
      }
      if (!best || rank < best.rank) best = { rank, s: pick.s };
    }
    return best ? best.s : null;
  }
  function detectSex(lines) {
    for (const L of lines) {
      const n = ' ' + norm(L.text) + ' ';
      if (!/ (sex|gender|age) /.test(n)) continue;
      if (/ female /.test(n)) return 'F';
      if (/ male /.test(n)) return 'M';
      if (/ \d+ ?(y|yr|yrs|years)? ?f /.test(n)) return 'F';
      if (/ \d+ ?(y|yr|yrs|years)? ?m /.test(n)) return 'M';
    }
    return null;
  }
  const OTHER_SKIP = /\b(page|patient|name|age|sex|gender|mobile|phone|tel|ref|referred|referring|doctor|dr|sample|barcode|lab|uhid|sid|pid|id|registration|reg|collected|received|reported|printed|report|date|time|address|pin|email|www|http|dob|bill|invoice|amount|rs|inr|visit|accession|client|center|centre|branch|signature|consultant|pathologist|end|method|note|remarks?)\b/;

  function toBase(testId, v, unit, lo, hi) {
    const t = TESTS[testId];
    const out = { v, u: null, lo: lo == null ? null : lo, hi: hi == null ? null : hi, note: null, warn: false };
    const conv = t.conv || {};
    const inPl = x => !t.plaus || (x >= t.plaus[0] && x <= t.plaus[1]);
    if (unit && unit !== t.unit) {
      if (t.altUnits && t.altUnits.includes(unit)) { out.u = unit; return out; }
      const f = conv[unit];
      if (f) {
        out.v = round(f(v), t.dp == null ? 2 : t.dp + 1);
        out.lo = lo == null ? null : round(f(lo), 3); out.hi = hi == null ? null : round(f(hi), 3);
        out.note = 'Converted from ' + unitLabel(unit);
        if (!inPl(out.v)) { out.warn = true; out.note += '. The value looks unusual; check it'; }
        return out;
      }
      out.warn = true; out.note = 'The report\'s unit (' + unitLabel(unit) + ') wasn\'t recognised; check the value';
      return out;
    }
    if (!unit && !inPl(v)) {
      for (const [cu, f] of Object.entries(conv)) {
        const x = f(v);
        if (inPl(x)) {
          out.v = round(x, t.dp == null ? 2 : t.dp + 1);
          out.lo = lo == null ? null : round(f(lo), 3); out.hi = hi == null ? null : round(f(hi), 3);
          out.note = 'No unit on the report; read as ' + unitLabel(cu); out.warn = true;
          return out;
        }
      }
      out.warn = true; out.note = 'The value looks unusual; check it';
    }
    return out;
  }

  function parseReport(pages, learned, today) {
    today = today || todayISO();
    const lines = buildLines(pages);
    const textLength = lines.reduce((s, L) => s + L.text.length, 0);
    const sex = detectSex(lines);
    const date = detectDate(lines, today);
    const found = {};
    const others = [];
    let abo = null, rh = null, bgLine = null;
    const docNorm = lines.map(L => norm(L.text)).join(' \n ');
    const isPap = /pap smear|pap test|cervical cytology|liquid based cytology|cervico vaginal/.test(docNorm);
    const used = new Set();

    function put(testId, item) { if (!found[testId]) found[testId] = Object.assign({ test: testId }, item); }

    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const L = lines[i];
      L.cells = splitMerged(L.cells);
      const nFull = norm(L.text);
      if (isPap && !found.pap) {
        if (/negative for intraepithelial lesion|(?:^| )nilm(?= |$)/.test(nFull)) put('pap', { v: 'normal', line: L.text });
        else if (/(?:^| )(ascus|asc us|asc h|lsil|hsil|agc|atypical squamous|atypical glandular|squamous cell carcinoma|adenocarcinoma)(?= |$)/.test(nFull) && !/negative for/.test(nFull)) put('pap', { v: 'abnormal', line: L.text });
      }
      const vi = firstValueCell(L.cells);
      if (vi === 0) continue; // value-only line; handled with the line before
      const labelCells = vi > 0 ? L.cells.slice(0, vi) : L.cells;
      const labelRaw = labelCells.map(c => c.text).join(' ');
      const m = matchAlias(labelRaw, learned);
      const pushOther = () => {
        if (vi <= 0) return;
        const lab = norm(labelRaw);
        const letters = (lab.match(/[a-z]/g) || []).length;
        if (letters >= 3 && lab.length <= 60 && !OTHER_SKIP.test(lab)) {
          const pv = parseValueCell(L.cells[vi].text);
          others.push({ key: lab, label: labelRaw, valueText: L.cells.slice(vi).map(c => c.text).join(' '), v: pv ? pv.v : null, line: L.text, cells: L.cells.slice(vi).map(c => c.text) });
        }
      };
      if (!m) { pushOther(); continue; }
      if (m.test === '_ignore') continue;
      const t = TESTS[m.test];
      // Text after the matched name, from the full line
      const aliasRe = new RegExp('(?:^| )' + escRe(m.a) + '(?= |$)');
      const am = aliasRe.exec(nFull);
      const afterNorm = am ? nFull.slice(am.index + am[0].length).trim() : '';
      let valueCells = vi > 0 ? L.cells.slice(vi) : null;
      let lineText = L.text;
      // Name on one line, value on the next
      const next = lines[i + 1];
      if (next) next.cells = splitMerged(next.cells);
      if (next && !used.has(i + 1) && (vi < 0) && firstValueCell(next.cells) === 0 && (!t || t.kind === 'num' || t.kind === 'bp' || t.numericCut != null)) {
        valueCells = next.cells; lineText = L.text + ' / ' + next.text; used.add(i + 1);
      }

      if (m.test === '_rh' || (t && t.kind === 'bloodgroup')) {
        let raw = afterNorm;
        if (!raw && next && !used.has(i + 1) && !matchAlias(next.text, learned)) { raw = norm(next.text); }
        const r = parseBloodGroupText(raw);
        if (m.test === '_rh') { if (r.rh && !rh) { rh = r.rh; bgLine = bgLine ? bgLine + ' / ' + L.text : L.text; } }
        else { if (r.abo && !abo) { abo = r.abo; bgLine = bgLine ? L.text + ' / ' + bgLine : L.text; } if (r.rh && !rh) rh = r.rh; }
        continue;
      }
      if (!t) continue;

      if (t.kind === 'bp') {
        const bm = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(valueCells ? valueCells.map(c => c.text).join(' ') : L.text);
        if (bm) put('bp', { v: +bm[1], v2: +bm[2], line: lineText });
        continue;
      }
      if (t.kind === 'qual') {
        let code = null, numericNote = null;
        if (valueCells && t.numericCut !== undefined) {
          const pv = parseValueCell(valueCells[0].text);
          if (pv) {
            const restText = [pv.rest].concat(valueCells.slice(1).map(c => c.text)).join(' ');
            const unit = pv.unit || (valueCells[1] && canonUnit(valueCells[1].text)) || null;
            const rg = parseRange(restText, sex);
            let cut = rg ? (rg.hi != null ? rg.hi : rg.lo) : null;
            if (cut == null && t.numericCut != null && (!t.cutUnit || !unit || unit === t.cutUnit)) cut = t.numericCut;
            if (cut != null) {
              code = t.sense === 'below' ? (pv.v < cut ? 'neg' : 'pos') : (pv.v >= cut ? 'pos' : 'neg');
              numericNote = 'Read from the value ' + pv.v + (unit ? ' ' + unitLabel(unit) : '') + ' against a cut-off of ' + cut;
            }
          } else if (t.qualOnly) { /* fall through to keywords */ }
        }
        if (t.qualOnly && vi > 0 && !qualCode(afterNorm)) { pushOther(); continue; } // a numeric value, not a urine result
        if (!code) code = qualCode(afterNorm);
        if (!code && next && !used.has(i + 1) && !matchAlias(next.cells[0].text, learned)) {
          const c2 = qualCode(norm(next.text));
          if (c2) { code = c2; used.add(i + 1); lineText = L.text + ' / ' + next.text; }
        }
        let v = null;
        if (code) {
          const opts = t.options.map(o => o[0]);
          if (opts.includes(code)) v = code;
          else if (code === 'trace' && opts.includes('pos')) v = 'pos';
        }
        put(t.id, { v, line: lineText, note: numericNote, warn: v == null });
        continue;
      }
      if (t.kind !== 'num') continue;
      if (!valueCells) continue;
      const pv = parseValueCell(valueCells[0].text);
      if (!pv) continue;
      let unit = pv.unit;
      let restCells = valueCells.slice(1).map(c => c.text);
      if (!unit && restCells.length) {
        const up = unitPrefix(restCells[0]);
        if (up) { unit = up.unit; restCells = [up.rest].concat(restCells.slice(1)); }
      }
      const rg = parseRange([pv.rest].concat(restCells).join(' '), sex);
      const b = toBase(t.id, pv.v, unit, rg ? rg.lo : null, rg ? rg.hi : null);
      put(t.id, { v: b.v, u: b.u, q: pv.q, lo: b.lo, hi: b.hi, note: b.note, warn: b.warn, line: lineText });
    }
    if (abo || rh) put('bloodgroup', { v: abo && rh ? abo + rh : null, abo, rh, line: bgLine, warn: !(abo && rh) });
    // Non-HDL from total and HDL when the lab doesn't report it
    if (!found.nonhdl && found.tc && found.hdl && found.tc.v != null && found.hdl.v != null) {
      put('nonhdl', { v: round(found.tc.v - found.hdl.v, 0), note: 'Worked out as total cholesterol minus HDL', derived: true, line: '' });
    }
    const items = Object.values(found);
    const order = Object.keys(TESTS);
    items.sort((a, b) => order.indexOf(a.test) - order.indexOf(b.test));
    return { date, sex, items, others, textLength, lineCount: lines.length };
  }
  function parseBloodGroupText(n) {
    const t = ' ' + String(n || '') + ' ';
    const am = / (ab|a|b|o)(?= )/.exec(t);
    const pm = /(?:^| )(positive|pos)(?= )|(?:^| )\+(?= )/.exec(t);
    const nm = /(?:^| )(negative|neg)(?= )/.exec(t);
    let rh = null;
    if (pm && (!nm || pm.index < nm.index)) rh = '+';
    else if (nm) rh = '-';
    return { abo: am ? am[1].toUpperCase() : null, rh };
  }

  const HB = {
    VERSION, TESTS, PANELS, PANEL, PANEL_OF, VACCINES, VACCINE_STATUS, SKIP_TESTS, SOURCES, PLAN_PANELS, FLAG_WORD, UNIT_LABEL, BMI_ZONES, EGFR_ZONES,
    todayISO, parseISO, isISO, addMonths, addDays, daysBetween, fmtDate, fmtMonth, round, num, unitLabel, canonUnit,
    history, latest, ageOn, ctxFor, evaluate, evaluateBmi, evaluateEgfr, bmi, egfr, formatValue, zonesFor, describeZones,
    freqText, schedule, panelsFor, visibleTests, planStatus, partnerStatus, partnerKey, timeline, planTests, vaccineStatus,
    norm, matchAlias, buildLines, parseValueCell, parseRange, parseReport, toBase, detectDate, findDates
  };
  root.HB = HB;
  if (typeof module !== 'undefined' && module.exports) module.exports = HB;
})(typeof window !== 'undefined' ? window : globalThis);
