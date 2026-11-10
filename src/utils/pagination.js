function parsePage(value) {
  const page = Number.parseInt(String(value || '1'), 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 100000) : 1;
}

/**
 * Monta os dados de paginação preservando os filtros atuais na URL.
 */
function buildPagination({ total, page, perPage, basePath, params = {} }) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / perPage));
  const current = Math.min(page, pages);

  const hrefFor = (target) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    }
    if (target > 1) search.set('page', String(target));
    const text = search.toString();
    return text ? `${basePath}?${text}` : basePath;
  };

  const windowPages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, current + 2);
  for (let index = start; index <= end; index += 1) windowPages.push(index);

  return {
    total: Number(total || 0),
    page: current,
    pages,
    perPage,
    from: total ? (current - 1) * perPage + 1 : 0,
    to: Math.min(current * perPage, Number(total || 0)),
    prev: current > 1 ? hrefFor(current - 1) : null,
    next: current < pages ? hrefFor(current + 1) : null,
    first: start > 1 ? hrefFor(1) : null,
    last: end < pages ? hrefFor(pages) : null,
    links: windowPages.map((number) => ({ number, href: hrefFor(number), current: number === current })),
    hrefFor
  };
}

module.exports = { parsePage, buildPagination };
