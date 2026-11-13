const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({ model: null, effort: null, mode: 'default', access: 'workspace' });
const MODES = new Set(['default', 'plan']);
const ACCESS = new Set(['readonly', 'workspace', 'full']);

function normalize(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = { ...DEFAULTS };
  if (typeof source.model === 'string' && source.model.trim() && source.model.length <= 200) result.model = source.model;
  if (typeof source.effort === 'string' && source.effort.trim() && source.effort.length <= 64) result.effort = source.effort;
  if (MODES.has(source.mode)) result.mode = source.mode;
  if (ACCESS.has(source.access)) result.access = source.access;
  return result;
}

function load(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return normalize(JSON.parse(text));
  } catch {
    return { ...DEFAULTS };
  }
}

function save(file, data) {
  const normalized = normalize(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw error;
  }
  return normalized;
}

module.exports = { DEFAULTS, normalize, load, save };
