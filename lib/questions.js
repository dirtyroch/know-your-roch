'use strict';

const { CATEGORIES } = require('./config');

const banks = {
  favorites: require('./banks/favorites'),
  food: require('./banks/food'),
  childhood: require('./banks/childhood'),
  rather: require('./banks/rather'),
  habits: require('./banks/habits'),
  faith: require('./banks/faith'),
  embarrassing: require('./banks/embarrassing'),
  dreams: require('./banks/dreams'),
  who: require('./banks/who'),
};

function parseRow(category, row, i) {
  const [type, prompt, a, b, c] = row;
  const q = {
    id: `${category}-${String(i + 1).padStart(3, '0')}`,
    category,
    type,
    prompt,
  };
  if (type === 'choice' || type === 'either') q.options = a.slice();
  if (type === 'number') {
    q.min = a;
    q.max = b;
    q.unit = c || '';
  }
  if (type === 'text') q.placeholder = a || 'A few words';
  return q;
}

const ALL = [];
for (const cat of CATEGORIES) {
  const rows = banks[cat.id];
  if (!rows) throw new Error(`Missing question bank: ${cat.id}`);
  rows.forEach((row, i) => ALL.push(parseRow(cat.id, row, i)));
}

function copyQuestion(q) {
  const copy = { ...q };
  if (q.options) copy.options = q.options.slice();
  return copy;
}

function questionsForCategories(ids) {
  const set = new Set(ids || []);
  return ALL.filter((q) => set.has(q.category)).map(copyQuestion);
}

function categoryLabel(id) {
  return (CATEGORIES.find((c) => c.id === id) || {}).label || 'Custom';
}

function validateBank(list = ALL) {
  const errors = [];
  const ids = new Set();
  const types = new Set(['choice', 'either', 'number', 'text', 'who']);
  for (const q of list) {
    if (ids.has(q.id)) errors.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    if (!types.has(q.type)) errors.push(`bad type ${q.id}`);
    if (!q.prompt || q.prompt.length < 8) errors.push(`short prompt ${q.id}`);
    if (!String(q.prompt).includes('{{name}}')) errors.push(`missing name token ${q.id}`);
    if (q.type === 'choice' && (!q.options || q.options.length < 3 || q.options.length > 5)) errors.push(`choice options ${q.id}`);
    if (q.type === 'either' && (!q.options || q.options.length !== 2)) errors.push(`either options ${q.id}`);
    if (q.type === 'number' && !(Number.isInteger(q.min) && Number.isInteger(q.max) && q.min < q.max)) errors.push(`number range ${q.id}`);
    if ((q.type === 'choice' || q.type === 'either') && q.options.some((o) => !String(o).trim())) errors.push(`blank option ${q.id}`);
    if (!CATEGORIES.some((c) => c.id === q.category)) errors.push(`unknown category ${q.id}`);
  }
  for (const cat of CATEGORIES) {
    const n = list.filter((q) => q.category === cat.id).length;
    if (n < 30) errors.push(`category ${cat.id} only has ${n}`);
  }
  return errors;
}

module.exports = { ALL, questionsForCategories, categoryLabel, validateBank, copyQuestion };
