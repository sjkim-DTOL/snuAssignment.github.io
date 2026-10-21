const form = document.querySelector('#form');
const input = document.querySelector('#url');
const shorten = document.querySelector('#shorten');
const result = document.querySelector('#result');
const copy = document.querySelector('#copy');
const error = document.querySelector('#error');

const providers = [
  { host: 'is.gd', group: 'gd', format: 'json', endpoint: 'https://is.gd/create.php?format=json&url=' },
  { host: 'da.gd', group: 'dagd', format: 'text', endpoint: 'https://da.gd/s?url=' },
  { host: 'v.gd', group: 'gd', format: 'json', endpoint: 'https://v.gd/create.php?format=json&url=' }
];
const cache = new Map();
const cooldowns = new Map();
let pending = false;

class ShortenError extends Error {
  constructor(message, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

async function requestShortUrl(provider, url) {
  const response = await fetch(provider.endpoint + encodeURIComponent(url), {
    signal: AbortSignal.timeout(8000)
  });
  // is.gd/v.gd use HTTP 502 (or JSON errorcode 3) for rate limiting.
  if (response.status === 429 || (provider.group === 'gd' && response.status === 502)) {
    cooldowns.set(provider.group, Date.now() + 60000);
    throw new ShortenError('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (response.status === 400 || response.status === 422) {
    throw new ShortenError('입력한 URL을 단축할 수 없습니다. 주소를 확인해 주세요.', false);
  }
  if (!response.ok) throw new ShortenError(`HTTP ${response.status}`);

  let value;
  if (provider.format === 'json') {
    const data = await response.json();
    if (data.errorcode) {
      const code = Number(data.errorcode);
      if (code === 3) cooldowns.set(provider.group, Date.now() + 60000);
      if (code === 1 || code === 2) {
        throw new ShortenError('입력한 URL을 단축할 수 없습니다. 주소를 확인해 주세요.', false);
      }
      throw new ShortenError(data.errormessage || 'invalid response');
    }
    value = data.shorturl;
  } else {
    value = (await response.text()).trim();
  }
  const shortUrl = new URL(value);
  if (shortUrl.protocol !== 'https:' || shortUrl.hostname !== provider.host ||
      shortUrl.pathname === '/' || shortUrl.username || shortUrl.password) {
    throw new ShortenError('invalid response');
  }
  return shortUrl.href;
}

async function shortenUrl(url) {
  if (cache.has(url)) return cache.get(url);
  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    if ((cooldowns.get(provider.group) || 0) > Date.now()) continue;
    shorten.textContent = `단축 중 (${index + 1}/${providers.length})`;
    try {
      const shortUrl = await requestShortUrl(provider, url);
      cache.set(url, shortUrl);
      return shortUrl;
    } catch (cause) {
      console.warn(`${provider.host} URL shortening failed:`, cause);
      if (cause instanceof ShortenError && !cause.retryable) throw cause;
    }
  }
  throw new ShortenError('모든 단축 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

input.addEventListener('input', () => { shorten.disabled = pending || !input.value.trim(); });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  result.value = '';
  copy.disabled = true;
  let url;
  try { url = new URL(input.value.trim()); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    error.textContent = '사용자 정보가 없는 http:// 또는 https:// URL을 입력해 주세요.';
    return;
  }
  error.textContent = '';
  pending = true;
  shorten.disabled = true;
  try {
    result.value = await shortenUrl(url.href);
    copy.disabled = false;
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    pending = false;
    shorten.disabled = !input.value.trim();
    shorten.textContent = '단축하기';
  }
});

copy.addEventListener('click', async () => {
  if (!result.value) return;
  try {
    try { await navigator.clipboard.writeText(result.value); } catch {
      result.select();
      if (!document.execCommand('copy')) throw new Error('copy failed');
    }
    alert('복사하였습니다.');
  } catch {
    error.textContent = '자동 복사에 실패했습니다. 단축 URL을 선택해 직접 복사해 주세요.';
  }
});
