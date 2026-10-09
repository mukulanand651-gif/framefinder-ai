
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'for', 'of', 'with',
  'and', 'to', 'in', 'on', 'by'
]);

const normalize = value =>
  String(value || '')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function pluralize(word) {
  if (!word || word.endsWith('s')) return word;

  if (/[^aeiou]y$/.test(word)) {
    return word.slice(0, -1) + 'ies';
  }

  if (/(ch|sh|x|z)$/.test(word)) {
    return word + 'es';
  }

  return word + 's';
}

export function expandQueries(input, product = {}) {
  const original = normalize(input);

  const rawCategory = normalize(
    product.attributes?.productType ||
    product.productType ||
    ''
  );

  const brand = normalize(
    product.brand ||
    product.attributes?.brand ||
    ''
  );

  const queries = [];
  const add = value => {
    const q = normalize(value);

    if (q.length >= 3 && !queries.includes(q)) {
      queries.push(q);
    }
  };

  const words = original
    .split(' ')
    .filter(Boolean);

  const semanticWords = words.filter(
    word => !STOP_WORDS.has(word)
  );

  const categoryWords = rawCategory
    .split(' ')
    .filter(Boolean);

  add(original);

  for (const q of product.queries || []) {
    add(q);
  }

  if (rawCategory) {
    add(rawCategory);
  }

  if (brand && rawCategory) {
    add(`${brand} ${rawCategory}`);
  }

  if (semanticWords.length >= 2) {
    const first = semanticWords[0];
    const last = semanticWords.at(-1);

    add(`${first} ${pluralize(last)}`);
    add(`${pluralize(first)} ${pluralize(last)}`);

 
    add(`${pluralize(last)} for ${pluralize(first)}`);

    add(semanticWords.join(' '));
  }

  if (categoryWords.length) {
    const categoryHead = categoryWords.at(-1);
    const modifiers = semanticWords.filter(
      word => !categoryWords.includes(word)
    );

    if (modifiers.length) {
      add(`${pluralize(categoryHead)} for ${pluralize(modifiers[0])}`);
      add(`${modifiers[0]} ${pluralize(categoryHead)}`);
    }
  }

  if (semanticWords.length > 3) {
    add(semanticWords.slice(0, 3).join(' '));
    add(semanticWords.slice(-3).join(' '));
  }

  return queries.slice(0, 12);
}
