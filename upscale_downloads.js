// Acompanha somente pedidos de upscale registrados pelo Flow, sem ler arquivos.
const UPSCALE_JOBS_KEY = 'flowUpscaleDownloads';
let upscaleTrackingQueue = Promise.resolve();
function serializeUpscaleTracking(action) {
  const next = upscaleTrackingQueue.then(action);
  upscaleTrackingQueue = next.catch(() => {});
  return next;
}
function upscaleFileLabel(filename) {
  return String(filename || '').split(/[\\/]/).pop().replace(/\.mp4$/i, '')
    .replace(/\s*\(\d+\)$/, '').replace(/[_ -]*(?:720p|1080p|upscaled)$/i, '')
    .normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
function matchingUpscaleJobs(item, jobs) {
  if (!/\.mp4$/i.test(item.filename || '') || !Number.isFinite(Date.parse(item.startTime))) return [];
  const known = Object.values(jobs).filter(job => job.downloadId === item.id);
  if (known.length) return known;
  // Não associa downloads de outros sites só porque o nome coincide.
  let fromFlow = false;
  try {
    const address = item.referrer || item.url;
    const url = new URL(String(address).replace(/^blob:/, ''));
    fromFlow = url.hostname === 'flow.google.com';
  } catch (_) {}
  if (!fromFlow) return [];
  return Object.values(jobs).filter(job =>
    ['requesting', 'requested', 'unconfirmed'].includes(job.state) &&
    Date.parse(item.startTime) >= job.createdAt && Date.parse(item.startTime) - job.createdAt < 24 * 3600000 &&
    (!item.referrer?.includes('/project/') || item.referrer.includes('/project/' + job.project)) &&
    (upscaleFileLabel(item.filename) === upscaleFileLabel(job.label) ||
      /^[a-f0-9-]{36}$/i.test(job.mediaId) && String(item.url || '').includes(job.mediaId))
  );
}
async function syncUpscaleDownload(item) {
  const stored = await chrome.storage.local.get(UPSCALE_JOBS_KEY);
  const jobs = stored[UPSCALE_JOBS_KEY] || {};
  const matches = matchingUpscaleJobs(item, jobs);
  // Nomes repetidos ou duas resoluções sem identificação: nunca adivinhar.
  if (matches.length !== 1) return;
  const job = matches[0];
  job.downloadId = item.id;
  job.state = item.state === 'complete' ? 'complete' : item.state === 'interrupted' ? 'interrupted' : 'downloading';
  job.filename = String(item.filename || '').split(/[\\/]/).pop();
  job.error = item.error || '';
  job.updatedAt = Date.now();
  await chrome.storage.local.set({ [UPSCALE_JOBS_KEY]: jobs });
}
chrome.downloads.onCreated.addListener(item => { void serializeUpscaleTracking(() => syncUpscaleDownload(item)); });
chrome.downloads.onChanged.addListener(delta => {
  if (!delta.state && !delta.filename && !delta.error) return;
  void serializeUpscaleTracking(async () => {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item) await syncUpscaleDownload(item);
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'FLOW_UPSCALE_TRACK') return false;
  let project;
  try {
    const url = new URL(sender.tab?.url || '');
    if (url.hostname !== 'flow.google.com') throw new Error('Origem inválida');
    project = url.pathname.match(/\/project\/([^/]+)/)?.[1];
    if (!project) throw new Error('Projeto ausente');
  } catch (_) { sendResponse({ ok: false, error: 'Acompanhamento permitido apenas em projetos do Flow.' }); return false; }
  serializeUpscaleTracking(async () => {
    const stored = await chrome.storage.local.get(UPSCALE_JOBS_KEY);
    const jobs = stored[UPSCALE_JOBS_KEY] || {};
    const request = message.job || {};
    if (message.action === 'register') {
      if (!request.mediaId || !request.label || ![720, 1080].includes(Number(request.resolution))) throw new Error('Pedido inválido');
      const key = project + ':' + String(request.mediaId).slice(0, 200) + ':' + request.resolution;
      const previous = jobs[key];
      if (!previous || ['failed', 'unconfirmed', 'interrupted'].includes(previous.state)) {
        jobs[key] = { key, project, mediaId: String(request.mediaId).slice(0, 200), label: String(request.label).slice(0, 200),
          resolution: Number(request.resolution), state: 'requesting', createdAt: Date.now(), updatedAt: Date.now() };
      }
      await chrome.storage.local.set({ [UPSCALE_JOBS_KEY]: jobs });
      return { ok: true, job: jobs[key] };
    }
    if (message.action === 'update') {
      const job = jobs[request.key];
      if (!job || job.project !== project || !['requested', 'unconfirmed', 'failed'].includes(request.state)) throw new Error('Atualização inválida');
      if (!['complete', 'downloading', 'interrupted'].includes(job.state)) job.state = request.state;
      job.detail = String(request.detail || '').slice(0, 200);
      await chrome.storage.local.set({ [UPSCALE_JOBS_KEY]: jobs });
    }
    return { ok: true, jobs: Object.values(jobs).filter(job => job.project === project)
      .map(job => ({ ...job })).sort((a, b) => b.createdAt - a.createdAt) };
  }).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
  return true;
});
