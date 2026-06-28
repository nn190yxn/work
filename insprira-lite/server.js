import express from 'express';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) {
    const example = path.join(__dirname, '.env.example');
    if (fs.existsSync(example)) fs.copyFileSync(example, envFile);
  }
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3001);
const DESKTOP_MODE = process.env.DESKTOP_MODE === '1' || process.argv.includes('--desktop') || process.env.NODE_ENV === 'production';
const HOST = DESKTOP_MODE ? '127.0.0.1' : (process.env.HOST || '0.0.0.0');
const REDFOX_API_KEY = process.env.REDFOX_API_KEY || '';
const REDFOX_HOST = process.env.REDFOX_HOST || 'redfox.hk';
const LLM_BASE_URL = process.env.LLM_BASE_URL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const API_SETTINGS_FILE = path.join(__dirname, 'apiSettings.json');

const app = express();
app.use(express.json({ limit: '1mb' }));

function loadApiSettings() {
  let saved = {};
  try {
    if (fs.existsSync(API_SETTINGS_FILE)) {
      saved = JSON.parse(fs.readFileSync(API_SETTINGS_FILE, 'utf-8'));
    }
  } catch {}
  return {
    redfoxApiKey: saved.redfoxApiKey || REDFOX_API_KEY,
    redfoxHost: saved.redfoxHost || REDFOX_HOST,
    llmBaseUrl: saved.llmBaseUrl || LLM_BASE_URL,
    llmApiKey: saved.llmApiKey || LLM_API_KEY,
    llmModel: saved.llmModel || LLM_MODEL,
  };
}

function saveApiSettings(nextSettings) {
  const current = loadApiSettings();
  const redfoxHost = nextSettings.redfoxHost || current.redfoxHost || 'redfox.hk';
  if (!/^[a-z0-9.-]+$/i.test(redfoxHost)) {
    throw new Error('RedFox Host 格式不合法');
  }
  const llmBaseUrl = nextSettings.llmBaseUrl || current.llmBaseUrl || '';
  if (llmBaseUrl && new URL(llmBaseUrl).protocol !== 'https:') {
    throw new Error('LLM Base URL 必须使用 https');
  }
  const merged = {
    redfoxApiKey: nextSettings.redfoxApiKey || current.redfoxApiKey || '',
    redfoxHost,
    llmBaseUrl,
    llmApiKey: nextSettings.llmApiKey || current.llmApiKey || '',
    llmModel: nextSettings.llmModel || current.llmModel || 'gpt-4o-mini',
  };
  fs.writeFileSync(API_SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function maskValue(value) {
  if (!value) return '';
  const str = String(value);
  if (str.length <= 8) return `${str.slice(0, 2)}***`;
  return `${str.slice(0, 4)}***${str.slice(-4)}`;
}

function redfoxRequest(endpoint, body = {}) {
  const settings = loadApiSettings();
  if (!settings.redfoxApiKey) {
    return Promise.reject(new Error('RedFox API Key 未配置，请在 .env 中设置 REDFOX_API_KEY'));
  }
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: settings.redfoxHost,
      port: 443,
      path: `/story/api/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': settings.redfoxApiKey,
        'REDFOX_API_KEY': settings.redfoxApiKey,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 200 || json.code === 2000) {
            resolve(json.data);
          } else {
            reject(new Error(json.msg || `RedFox API 返回错误 (code: ${json.code})`));
          }
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(postData);
    req.end();
  });
}

async function storyAPI(path, body) {
  const settings = loadApiSettings();
  if (!settings.redfoxApiKey) {
    return Promise.reject(new Error('RedFox API Key 未配置'));
  }
  const url = new URL(`/story/api/${path}`, `https://${settings.redfoxHost}`);
  const lib = url.protocol === 'https:' ? https : http;
  const postData = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': settings.redfoxApiKey,
        'REDFOX_API_KEY': settings.redfoxApiKey,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 200 || json.code === 2000) {
            resolve(json.data);
          } else {
            reject(new Error(json.msg || `Story API error (code: ${json.code})`));
          }
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Story API 超时')); });
    req.write(postData);
    req.end();
  });
}

async function callLLM(messages, options = {}) {
  const settings = loadApiSettings();
  if (!settings.llmBaseUrl || !settings.llmApiKey) {
    throw new Error('LLM 未配置，请在 .env 中设置 LLM_BASE_URL 和 LLM_API_KEY');
  }
  const url = new URL('/v1/chat/completions', settings.llmBaseUrl);
  const postData = JSON.stringify({
    model: settings.llmModel,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 16384,
  });
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.llmApiKey}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: options.timeoutMs || 180000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices?.[0]?.message?.content) {
            resolve(json.choices[0].message.content);
          } else {
            reject(new Error(json.error?.message || 'LLM 返回异常'));
          }
        } catch (e) {
          reject(new Error(`LLM 响应解析失败: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM request timeout')); });
    req.write(postData);
    req.end();
  });
}

app.get('/api/status', (_req, res) => {
  const settings = loadApiSettings();
  res.json({
    redfox: !!settings.redfoxApiKey,
    llm: !!(settings.llmBaseUrl && settings.llmApiKey),
    model: settings.llmModel,
  });
});

app.get('/api/settings', (_req, res) => {
  const settings = loadApiSettings();
  res.json({
    redfoxHost: settings.redfoxHost,
    redfoxApiKeyMasked: maskValue(settings.redfoxApiKey),
    redfoxConfigured: !!settings.redfoxApiKey,
    llmBaseUrl: settings.llmBaseUrl,
    llmApiKeyMasked: maskValue(settings.llmApiKey),
    llmConfigured: !!(settings.llmBaseUrl && settings.llmApiKey),
    llmModel: settings.llmModel,
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const settings = saveApiSettings(req.body || {});
    res.json({
      ok: true,
      settings: {
        redfoxHost: settings.redfoxHost,
        redfoxApiKeyMasked: maskValue(settings.redfoxApiKey),
        redfoxConfigured: !!settings.redfoxApiKey,
        llmBaseUrl: settings.llmBaseUrl,
        llmApiKeyMasked: maskValue(settings.llmApiKey),
        llmConfigured: !!(settings.llmBaseUrl && settings.llmApiKey),
        llmModel: settings.llmModel,
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PLATFORM_KEY_MAP = { dy: 'dyList', ks: 'ksList', wb: 'wbList', zh: 'zhList', bd: 'bdList', bz: 'bzList', tt: 'ttList' };

app.post('/api/hotspot/platform', async (req, res) => {
  const { platform, limit = 30 } = req.body;
  if (!['dy', 'xhs', 'gzh', 'sph'].includes(platform)) {
    return res.status(400).json({ error: '不支持的平台，可选: dy, xhs, gzh, sph' });
  }
  try {
    if (platform === 'dy') {
      const items = await storyAPI('dy/search/likesRank', { keyword: '热门', pageSize: limit });
      const records = (Array.isArray(items) ? items : []).slice(0, limit).map((item, i) => ({
        title: item.title || item.desc || '',
        score: Number(item.likes || item.likeCount || item.hotCount || 0),
        url: item.url || '',
        index: item.index || i + 1,
      }));
      return res.json({ records, total: records.length });
    }

    if (platform === 'gzh') {
      const result = await storyAPI('gzhData/searchArticle', { keyword: '热门', pageSize: limit });
      const items = result?.list || (Array.isArray(result) ? result : []);
      const records = items.slice(0, limit).map((item, i) => ({
        title: item.title || '',
        score: Number(item.readCount || item.likeCount || item.hotValue || 0),
        url: item.url || item.link || '',
        index: item.index || i + 1,
      }));
      return res.json({ records, total: records.length });
    }

    if (platform === 'xhs' || platform === 'sph') {
      return res.json({ records: [], total: 0, message: `${platformLabel(platform)}数据接口暂未接入` });
    }

    const result = await redfoxRequest('hotSpot/getListByPlatformWithKeyword', {
      platform,
      keyword: '热门',
      pageSize: limit,
    });
    const key = PLATFORM_KEY_MAP[platform];
    const items = key ? (result[key] || []) : [];
    const records = items.slice(0, limit).map(item => ({
      title: item.title || '',
      score: Number(item.hotCount || item.hotValue || 0),
      url: item.url || '',
      index: item.index || 0,
    }));
    res.json({ records, total: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/hotspot/search', async (req, res) => {
  const { keyword, platform } = req.body;
  if (!keyword) return res.status(400).json({ error: '缺少 keyword' });
  try {
    const result = await redfoxRequest('hotSpot/getListByPlatformWithKeyword', {
      platform: platform || 'dy',
      keyword,
      pageSize: 20,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/hotspot/keywords', async (_req, res) => {
  try {
    const result = await redfoxRequest('hotKeyword/list', {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trends', async (req, res) => {
  const { days = 0 } = req.body;
  try {
    const allItems = [];

    const [dyR, gzhR] = await Promise.allSettled([
      storyAPI('dy/search/likesRank', { keyword: '热门', pageSize: 30 }),
      storyAPI('gzhData/searchArticle', { keyword: '热门', pageSize: 30 }),
    ]);

    if (dyR.status === 'fulfilled' && Array.isArray(dyR.value)) {
      for (const [i, item] of dyR.value.entries()) {
        const title = (item.title || item.desc || '').trim();
        if (!title) continue;
        allItems.push({
          platform: '抖音',
          title,
          score: Number(item.likes || item.likeCount || item.hotCount || 0),
          rank: item.index || i + 1,
        });
      }
    }

    if (gzhR.status === 'fulfilled' && gzhR.value) {
      const gzhItems = gzhR.value.list || (Array.isArray(gzhR.value) ? gzhR.value : []);
      for (const [i, item] of gzhItems.entries()) {
        const title = (item.title || '').trim();
        if (!title) continue;
        allItems.push({
          platform: '公众号',
          title,
          score: Number(item.readCount || item.likeCount || item.hotValue || 0),
          rank: item.index || i + 1,
        });
      }
    }

    if (allItems.length === 0) {
      return res.json({ themes: [], summary: '暂无可分析的趋势数据', totalItems: 0, generatedAt: Date.now() });
    }

    const topItems = allItems.sort((a, b) => b.score - a.score).slice(0, 40);

    const indexed = topItems.map((item, i) => ({
      id: i + 1,
      title: item.title,
      platform: item.platform,
      score: item.score,
      rank: item.rank,
    }));

    const extractPrompt = `从以下各平台热榜标题中提取可跨平台聚类的主题关键词。不得编造，不得输出泛词。
每个主题必须引用输入条目的 id。最多 12 个主题。相同事件合并。
严格 JSON：{"themes":[{"name":"主题名","aliases":["同义写法"],"titleIds":[1,2,3]}],"summary":"当日热点概述"}`;

    let analysis;
    try {
      const raw = await callLLM([
        { role: 'system', content: extractPrompt },
        { role: 'user', content: JSON.stringify(indexed) },
      ], { maxTokens: 4096, timeoutMs: 70000, temperature: 0.3 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      analysis = {
        themes: indexed.slice(0, 12).map(item => ({
          name: item.title.slice(0, 18),
          aliases: [],
          titleIds: [item.id],
        })),
        summary: 'LLM 趋势聚类暂不可用，已按热度返回候选主题。',
      };
    }

    const themes = (analysis.themes || []).map(theme => {
      const matched = indexed.filter(t => (theme.titleIds || []).includes(t.id));
      const platforms = [...new Set(matched.map(t => t.platform))];
      const totalScore = matched.reduce((s, t) => s + t.score, 0);
      const avgRank = matched.length ? matched.reduce((s, t) => s + (t.rank || 51), 0) / matched.length : 51;
      const intensity = Math.round(matched.length * 10 + platforms.length * 15 + Math.max(1, 51 - avgRank));
      return {
        name: theme.name || '',
        aliases: theme.aliases || [],
        mentions: matched.length,
        platforms,
        totalScore,
        intensity,
      };
    });
    themes.sort((a, b) => b.intensity - a.intensity);

    res.json({
      themes: themes.slice(0, 12),
      summary: analysis.summary || '',
      totalItems: allItems.length,
      generatedAt: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const CONFIG_FILE = path.join(__dirname, 'keywordConfig.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return { keywords: {}, feedback: [], pinned: [], blocked: [] };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

const TRACKER_FILE = path.join(__dirname, 'trackerData.json');

function loadTracker() {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf-8'));
      data.profiles ||= [];
      data.topics ||= [];
      data.snapshots ||= [];
      data.assets ||= [];
      return data;
    }
  } catch {}
  return { profiles: [], topics: [], snapshots: [], assets: [] };
}

function saveTracker(data) {
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeWork(item) {
  const followerCount = Number(item.followerCount || 0);
  const likeCount = Number(item.likeCount || item.likes || 0);
  const commentCount = Number(item.commentCount || 0);
  const shareCount = Number(item.shareCount || 0);
  const collectCount = Number(item.collectCount || 0);
  const engagement = likeCount + commentCount * 2 + shareCount * 3 + collectCount * 2;
  const followerBase = Math.max(followerCount, 1);
  const engagementRate = engagement / followerBase;
  const viralScore = Math.round(Math.log10(likeCount + 10) * 20 + Math.min(engagementRate, 20) * 8 + shareCount / 1000 + collectCount / 1000);

  return {
    workId: item.workId || crypto.randomUUID(),
    title: item.title || item.content || '',
    content: item.content || item.title || '',
    accountId: item.accountId || '',
    accountName: item.accountName || '',
    followerCount,
    likeCount,
    commentCount,
    shareCount,
    collectCount,
    engagement,
    engagementRate: Number(engagementRate.toFixed(2)),
    viralScore,
    publishTime: item.publishTime || '',
    category: item.category || '',
    duration: item.duration || 0,
    coverUrl: item.coverUrl || '',
    workUrl: item.workUrl || item.url || '',
    platform: '抖音',
    platformId: 'dy',
  };
}

async function fetchLowFollowerViral({ keyword, maxFollowers = 50000, minLikes = 1000, pageSize = 50 }) {
  const raw = await storyAPI('dy/search/likesRank', { keyword: keyword || '热门', pageSize });
  const items = (Array.isArray(raw) ? raw : [])
    .map(normalizeWork)
    .filter(item => item.title && item.followerCount > 0 && item.followerCount <= Number(maxFollowers) && item.likeCount >= Number(minLikes))
    .sort((a, b) => b.viralScore - a.viralScore);

  return items;
}

function fallbackDeconstruction(work, profile) {
  const title = work.title || work.content || '';
  return {
    hook: title.slice(0, 30) || '用高反差场景开头',
    viralType: work.collectCount > work.shareCount ? '收藏型爆款' : work.commentCount > work.shareCount ? '讨论型爆款' : '传播型爆款',
    structure: ['强场景开头', '具体冲突或痛点', '过程展示', '结果反转或价值总结'],
    interactionReason: `点赞${work.likeCount || 0}，评论${work.commentCount || 0}，分享${work.shareCount || 0}，收藏${work.collectCount || 0}`,
    reusableTemplate: `${profile?.brandName || '品牌'}可复用为：本地场景 + 目标人群痛点 + 低门槛解决方案 + 明确行动引导`,
    fitIp: profile?.ipName || profile?.ipType || '品牌/IP账号',
    nextActions: ['改写为同城场景', '保留开头冲突', '替换为自身业务案例', '生成短视频脚本'],
  };
}

app.get('/api/tracker', (_req, res) => {
  res.json(loadTracker());
});

app.post('/api/tracker/profile', (req, res) => {
  const { brandName, ipName, ipType, audience, city, contentGoal } = req.body;
  if (!brandName && !ipName) return res.status(400).json({ error: '请填写品牌或IP名称' });
  const data = loadTracker();
  const profile = {
    id: crypto.randomUUID(),
    brandName: brandName || '',
    ipName: ipName || '',
    ipType: ipType || '',
    audience: audience || '',
    city: city || '',
    contentGoal: contentGoal || '',
    createdAt: Date.now(),
  };
  data.profiles.unshift(profile);
  saveTracker(data);
  res.json({ ok: true, profile, data });
});

app.post('/api/tracker/topic', (req, res) => {
  const { profileId, keyword, platform = 'dy', notes } = req.body;
  if (!keyword) return res.status(400).json({ error: '请填写跟踪话题关键词' });
  const data = loadTracker();
  const topic = {
    id: crypto.randomUUID(),
    profileId: profileId || '',
    keyword,
    platform,
    notes: notes || '',
    createdAt: Date.now(),
    lastSnapshotAt: 0,
  };
  data.topics.unshift(topic);
  saveTracker(data);
  res.json({ ok: true, topic, data });
});

app.post('/api/viral/radar', async (req, res) => {
  const { keyword, maxFollowers = 50000, minLikes = 1000, pageSize = 50 } = req.body;
  if (!keyword) return res.status(400).json({ error: '请填写搜索关键词' });
  try {
    const items = await fetchLowFollowerViral({ keyword, maxFollowers, minLikes, pageSize });
    res.json({ keyword, items, total: items.length, filters: { maxFollowers, minLikes, pageSize } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracker/snapshot', async (req, res) => {
  const { topicId, keyword, maxFollowers = 50000, minLikes = 1000 } = req.body;
  const data = loadTracker();
  const topic = data.topics.find(item => item.id === topicId);
  const searchKeyword = keyword || topic?.keyword;
  if (!searchKeyword) return res.status(400).json({ error: '请提供 topicId 或 keyword' });

  try {
    const items = await fetchLowFollowerViral({ keyword: searchKeyword, maxFollowers, minLikes, pageSize: 50 });
    const snapshot = {
      id: crypto.randomUUID(),
      topicId: topic?.id || '',
      keyword: searchKeyword,
      total: items.length,
      topItems: items.slice(0, 10),
      createdAt: Date.now(),
    };
    data.snapshots.unshift(snapshot);
    if (topic) topic.lastSnapshotAt = snapshot.createdAt;
    saveTracker(data);
    res.json({ ok: true, snapshot, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/assets/save', (req, res) => {
  const { work, profileId, topicKeyword, analysis, status = '待改写' } = req.body;
  if (!work?.title) return res.status(400).json({ error: '请提供要保存的作品' });

  const data = loadTracker();
  if (!Array.isArray(data.assets)) data.assets = [];

  const existing = work.workId
    ? data.assets.find(item => item.work?.workId === work.workId)
    : null;
  if (existing) {
    existing.profileId = profileId || existing.profileId || '';
    existing.topicKeyword = topicKeyword || existing.topicKeyword || '';
    existing.analysis = analysis || existing.analysis || null;
    existing.status = status || existing.status || '待改写';
    existing.updatedAt = Date.now();
    saveTracker(data);
    return res.json({ ok: true, asset: existing, data });
  }

  const asset = {
    id: crypto.randomUUID(),
    profileId: profileId || '',
    topicKeyword: topicKeyword || '',
    status,
    work,
    analysis: analysis || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  data.assets.unshift(asset);
  saveTracker(data);
  res.json({ ok: true, asset, data });
});

app.post('/api/assets/status', (req, res) => {
  const { assetId, status } = req.body;
  if (!assetId || !status) return res.status(400).json({ error: '请提供 assetId 和 status' });
  const data = loadTracker();
  if (!Array.isArray(data.assets)) data.assets = [];
  const asset = data.assets.find(item => item.id === assetId);
  if (!asset) return res.status(404).json({ error: '资产不存在' });
  asset.status = status;
  asset.updatedAt = Date.now();
  saveTracker(data);
  res.json({ ok: true, asset, data });
});

app.post('/api/viral/deconstruct', async (req, res) => {
  const { work, profile } = req.body;
  if (!work) return res.status(400).json({ error: '请提供作品信息' });

  const prompt = `请拆解这个低粉爆款作品，输出可复制策略。严格 JSON:
{"hook":"开头钩子","viralType":"爆点类型","structure":["结构步骤"],"interactionReason":"互动原因","reusableTemplate":"可复制模板","fitIp":"适配IP","nextActions":["下一步动作"]}

作品: ${JSON.stringify(work)}
品牌/IP: ${JSON.stringify(profile || {})}`;

  try {
    const raw = await callLLM([
      { role: 'system', content: '你是自媒体爆款拆解顾问，擅长把作品拆成可复制模板。只输出 JSON。' },
      { role: 'user', content: prompt },
    ], { maxTokens: 4096, timeoutMs: 70000, temperature: 0.5 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    res.json({ analysis });
  } catch {
    res.json({ analysis: fallbackDeconstruction(work, profile), fallback: true });
  }
});

app.get('/api/keyword-config', (req, res) => {
  res.json(loadConfig());
});

app.post('/api/keyword-config/save', (req, res) => {
  const { keywords, pinned, blocked } = req.body;
  const cfg = loadConfig();
  if (keywords) cfg.keywords = keywords;
  if (pinned !== undefined) cfg.pinned = pinned;
  if (blocked !== undefined) cfg.blocked = blocked;
  saveConfig(cfg);
  res.json({ ok: true, config: cfg });
});

app.post('/api/keyword-config/feedback', (req, res) => {
  const { topicTitle, topicKeywords, action } = req.body;
  const cfg = loadConfig();

  if (action === 'clear') {
    cfg.keywords = {};
    cfg.feedback = [];
    saveConfig(cfg);
    return res.json({ ok: true, config: cfg });
  }

  const weight = action === 'like' ? 0.5 : action === 'dislike' ? -0.5 : action === 'block' ? -2 : 0;

  const words = Array.isArray(topicKeywords)
    ? topicKeywords
    : (typeof topicKeywords === 'string' ? topicKeywords.split(/[,，、;；\s]+/).filter(Boolean) : []);

  for (const word of words) {
    cfg.keywords[word] = (cfg.keywords[word] || 0) + weight;
  }

  cfg.feedback.push({
    topic: topicTitle || '',
    words,
    action,
    weight,
    time: Date.now(),
  });

  for (const [kw, w] of Object.entries(cfg.keywords)) {
    if (w === 0) delete cfg.keywords[kw];
  }

  saveConfig(cfg);
  res.json({ ok: true, config: cfg });
});

app.post('/api/discover', async (req, res) => {
  const { domain, intent, platforms } = req.body;
  if (!domain && !intent) {
    return res.status(400).json({ error: '请提供领域关键词或需求描述' });
  }
  const userIntent = [domain, intent].filter(Boolean).join(' - ');
  const tgtPlatforms = (platforms && platforms.length > 0) ? platforms : ['dy', 'wb', 'ks', 'zh', 'bd', 'bz', 'tt'];

  try {
    const searchKw = domain || intent.substring(0, 20);
    const [hotSpotR, dyR, gzhR] = await Promise.allSettled([
      redfoxRequest('hotSpot/getListByPlatformWithKeyword', {
        platform: 'dy', keyword: '热门', pageSize: 8,
      }),
      tgtPlatforms.includes('dy') ? storyAPI('dy/search/likesRank', { keyword: searchKw, pageSize: 15 }) : Promise.resolve(null),
      tgtPlatforms.includes('gzh') ? storyAPI('gzhData/searchArticle', { keyword: searchKw, pageSize: 15 }) : Promise.resolve(null),
    ]);

    const allItems = [];

    if (hotSpotR.status === 'fulfilled' && hotSpotR.value) {
      const r = hotSpotR.value;
      for (const [plat, key] of Object.entries(PLATFORM_KEY_MAP)) {
        if (!tgtPlatforms.includes(plat) || !r[key]) continue;
        for (const item of r[key]) {
          const title = (item.title || '').trim();
          if (!title) continue;
          allItems.push({
            index: allItems.length,
            platform: platformLabel(plat),
            platformId: plat,
            title,
            hotCount: Number(item.hotCount || item.hotValue || 0),
          });
        }
      }
    }

    if (dyR.status === 'fulfilled' && Array.isArray(dyR.value)) {
      for (const item of dyR.value) {
        const title = (item.title || item.desc || '').trim();
        if (!title || title.length < 2) continue;
        allItems.push({
          index: allItems.length,
          platform: '抖音',
          platformId: 'dy',
          title,
          hotCount: Number(item.likes || item.likeCount || item.hotCount || 0),
        });
      }
    }

    if (gzhR.status === 'fulfilled' && gzhR.value) {
      const gzhItems = gzhR.value.list || (Array.isArray(gzhR.value) ? gzhR.value : []);
      for (const item of gzhItems) {
        const title = (item.title || '').trim();
        if (!title || title.length < 3) continue;
        allItems.push({
          index: allItems.length,
          platform: '公众号',
          platformId: 'gzh',
          title,
          hotCount: Number(item.readCount || item.likeCount || item.hotValue || 0),
        });
      }
    }

    const sample = [];
    const seen = new Set();
    for (const item of allItems) {
      if (!seen.has(item.title.substring(0, 20))) {
        seen.add(item.title.substring(0, 20));
        sample.push(item);
      }
      if (sample.length >= 50) break;
    }

    const scorePrompt = `对以下每一条热榜，评估与用户意图"${userIntent}"的关联度，给出0-10整数分。
10=高度匹配（主题直接相关），5=中度相关，0=无关。每个idx必须打分。理由≤8字。
严格 JSON:{"keywords":[3-5个意图核心词],"scores":[{"idx":0,"rel":7,"reason":"短理由"}]}`;

    const raw = await callLLM([
      { role: 'system', content: scorePrompt },
      { role: 'user', content: JSON.stringify(sample.map(item => ({
        idx: item.index, t: item.title, p: item.platform,
      }))) },
    ]);

    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: '关联分析 LLM 返回格式异常' });
    }

    const keywords = result.keywords || [];
    const scoreMap = {};
    if (Array.isArray(result.scores)) {
      for (const s of result.scores) scoreMap[s.idx] = { rel: Number(s.rel) || 0, reason: s.reason || '' };
    }

    const scored = sample
      .map(item => ({
        ...item,
        relevance: (scoreMap[item.index] || {}).rel || 0,
        reason: (scoreMap[item.index] || {}).reason || '',
      }))
      .sort((a, b) => b.relevance - a.relevance);

    const related = scored.filter(item => item.relevance >= 1);

    res.json({
      keywords,
      intent: userIntent,
      items: related,
      total: related.length,
      sampled: sample.length,
      all: allItems.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/audience', async (req, res) => {
  const { business, gender, ageRange, roles, interests, city, cityLevel } = req.body;

  const personaParts = [];
  if (business) personaParts.push(`业务:${business}`);
  if (gender) personaParts.push(`性别:${gender}`);
  if (ageRange) personaParts.push(`年龄:${ageRange}`);
  if (city) personaParts.push(`城市:${city}`);
  if (cityLevel) personaParts.push(`${cityLevel}城市`);
  if (roles) personaParts.push(`角色:${roles}`);
  if (interests) personaParts.push(`兴趣:${interests}`);
  const personaDesc = personaParts.join('，');

  try {
    const interestList = (interests || '').split(/[,，、\s]+/).filter(Boolean);
    const searchKw = interestList[0] || business || '热门';

    const [hotSpotR, dyR, gzhR] = await Promise.allSettled([
      redfoxRequest('hotSpot/getListByPlatformWithKeyword', {
        platform: 'dy', keyword: '热门', pageSize: 8,
      }),
      storyAPI('dy/search/likesRank', { keyword: searchKw, pageSize: 15 }),
      storyAPI('gzhData/searchArticle', { keyword: searchKw, pageSize: 15 }),
    ]);

    const allItems = [];

    if (hotSpotR.status === 'fulfilled' && hotSpotR.value) {
      const r = hotSpotR.value;
      for (const [plat, key] of Object.entries(PLATFORM_KEY_MAP)) {
        if (!r[key]) continue;
        for (const item of r[key]) {
          const title = (item.title || '').trim();
          if (!title) continue;
          allItems.push({
            index: allItems.length,
            platform: platformLabel(plat),
            platformId: plat,
            title,
            hotCount: Number(item.hotCount || item.hotValue || 0),
          });
        }
      }
    }

    if (dyR.status === 'fulfilled' && Array.isArray(dyR.value)) {
      for (const item of dyR.value) {
        const title = (item.title || item.desc || '').trim();
        if (!title || title.length < 2) continue;
        allItems.push({
          index: allItems.length,
          platform: '抖音',
          platformId: 'dy',
          title,
          hotCount: Number(item.likes || item.likeCount || item.hotCount || 0),
        });
      }
    }

    if (gzhR.status === 'fulfilled' && gzhR.value) {
      const gzhItems = gzhR.value.list || (Array.isArray(gzhR.value) ? gzhR.value : []);
      for (const item of gzhItems) {
        const title = (item.title || '').trim();
        if (!title || title.length < 3) continue;
        allItems.push({
          index: allItems.length,
          platform: '公众号',
          platformId: 'gzh',
          title,
          hotCount: Number(item.readCount || item.likeCount || item.hotValue || 0),
        });
      }
    }

    const seen = new Set();
    const sample = [];
    for (const item of allItems) {
      if (!seen.has(item.title.substring(0, 20))) {
        seen.add(item.title.substring(0, 20));
        sample.push(item);
      }
      if (sample.length >= 50) break;
    }

    const audiencePrompt = `你是一个内容策划师。你的客户是"${business || '某品牌'}"。
客户的目标客群是: ${personaDesc}

请站在这个客群的视角，对以下热榜逐一打分:
- 10分: 这客群刷手机时看到这条，会停下来仔细看（高度共鸣）
- 5分: 可能会扫一眼
- 0分: 完全不会关心，直接划走

核心原则: 从"这个客群的真实兴趣"打分，不是从"这个内容能不能关联到客户的业务"打分。
${business ? `客户业务"${business}"只作为选题角度的参考背景。关联不上就不硬蹭，留空angle。` : ''}

示例: 如果客群是"宝妈"，热榜是"世界杯决赛"→ 低分，她不关心。但如果热榜是"周末去哪遛娃"→ 高分。
示例: 如果客群是"户外爱好者"，热榜是"某运动员夺冠"→ 低分。但如果热榜是"徒步路线推荐"→ 高分。
${city ? `重要: 客户在${city}做本地业务。选址角度优先考虑${city}本地的美食、景点、活动、天气等内容。` : ''}

每个idx必须打分。严格 JSON:
{"persona":"一句话刻画客群画像","keywords":["该客群真实关心的3-5个热词(来自兴趣，非业务词)"],"scores":[{"idx":0,"rel":7,"angle":"选题角度(≤15字，关联不上留空)"}]}`;

    const raw = await callLLM([
      { role: 'system', content: audiencePrompt },
      { role: 'user', content: JSON.stringify(sample.map(item => ({
        idx: item.index, t: item.title, p: item.platform,
      }))) },
    ]);

    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: '客群分析 LLM 返回格式异常' });
    }

    const persona = result.persona || personaDesc;
    const keywords = result.keywords || [];
    const scoreMap = {};
    if (Array.isArray(result.scores)) {
      for (const s of result.scores) {
        scoreMap[s.idx] = { rel: Number(s.rel) || 0, angle: s.angle || '' };
      }
    }

    const items = sample
      .map(item => ({
        ...item,
        relevance: (scoreMap[item.index] || {}).rel || 0,
        angle: (scoreMap[item.index] || {}).angle || '',
      }))
      .filter(item => item.relevance >= 5)
      .sort((a, b) => b.relevance - a.relevance);

    res.json({
      persona,
      keywords,
      items,
      total: items.length,
      sampled: sample.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/copy/generate', async (req, res) => {
  const { topic, targetPlatform, intent } = req.body;
  if (!topic || !targetPlatform) {
    return res.status(400).json({ error: '请提供 topic 和 targetPlatform' });
  }

  const formatMap = {
    xhs: { style: '小红书图文笔记', sections: '标题→封面文案→正文(带emoji分段)→话题标签' },
    dy: { style: '抖音短视频脚本', sections: '开头钩子→正文口播→互动引导→BGM建议' },
    sph: { style: '微信视频号脚本', sections: '开头钩子→正文口播→结尾引导关注→话题标签' },
    gzh: { style: '公众号图文文章', sections: '标题→导语→正文段落→结尾互动' },
  };

  const fmt = formatMap[targetPlatform] || formatMap.xhs;

  const prompt = `用户意图: "${intent || topic.title}"
热点话题: "${topic.title}" (平台: ${topic.platform}, 热度: ${topic.hotCount || '未知'})

请为此热点生成一篇${fmt.style}，按以下结构输出: ${fmt.sections}
语言风格: 符合${fmt.style}调性，口语化、有网感，面向大众用户，300-500字。
严格 JSON: {"title":"文案标题","copy":"完整文案内容","hashtags":["标签1","标签2"]}`;

  try {
    const raw = await callLLM([
      { role: 'system', content: '你是一个资深内容创作者，擅长各平台文案撰写。只输出 JSON。' },
      { role: 'user', content: prompt },
    ]);

    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: '文案生成 LLM 返回格式异常' });
    }

    res.json({
      format: fmt.style,
      topic: topic.title,
      ...result,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/inspiration/generate', async (req, res) => {
  const { domain, platforms, keywordOverrides } = req.body;
  if (!domain && !keywordOverrides) {
    return res.status(400).json({ error: '至少需要提供 domain 或 keywordOverrides' });
  }
  try {
    const selectedPlatforms = platforms || ['dy', 'xhs', 'gzh', 'sph'];
    const hotItems = [];
    try {
      const r = await redfoxRequest('hotSpot/getListByPlatformWithKeyword', {
        platform: 'dy',
        keyword: '热门',
        pageSize: 20,
      });
      for (const [plat, key] of Object.entries(PLATFORM_KEY_MAP)) {
        if (r[key]) {
          const label = platformLabel(plat);
          for (const item of r[key]) {
            hotItems.push({ platform: label, title: item.title || '', score: Number(item.hotCount || item.hotValue || 0) });
          }
        }
      }
    } catch {}
    if (hotItems.length === 0) {
      return res.status(503).json({ error: '未能获取热点数据，请检查 RedFox API Key' });
    }

    const hotList = hotItems
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 30)
      .map((h, i) => `${i + 1}. [${platformLabel(h.platform)}] ${h.title} (热度: ${h.score})`)
      .join('\n');

    const platformNames = selectedPlatforms.map(platformLabel).join('、');
    const userDomain = domain ? `我的赛道：${domain}` : '';
    const userKeywords = keywordOverrides ? `指定关键词：${keywordOverrides}` : '';

    const systemPrompt = `你是资深自媒体选题策划师兼文案写手。

你的任务：基于当前各平台真实热点，为创作者生成可执行的选题建议 + 文案草稿。

【核心规则】
1. 每个选题必须关联至少一个热点，用"热点依据"注明关联了哪条热点
2. 选题角度要具体、可落地，不要泛泛而谈
3. 给出推荐发布平台和理由
4. 优先级按热点热度 + 选题可行性综合排序
5. 每个选题必须附带文案草稿，严格按平台类型区分格式：
   - 小红书/公众号 → 图文文案（含标题 + 正文3-5段 + 3-5个话题标签）
   - 抖音/视频号 → 视频脚本（含口播开头钩子 + 分镜描述 + 口播文案）
6. 严格输出 JSON 数组

输出格式：
[{"title":"选题标题","angle":"切入角度（1-2句）","hotBasis":"依据热点标题","platform":"推荐平台","priority":"high|medium|low","reason":"推荐理由（1句）","copyType":"图文|视频","copy":"完整的文案草稿内容"}]`;

    const userPrompt = [
      `当前关注的平台：${platformNames}`,
      userDomain,
      userKeywords,
      `\n当前各平台 TOP 热点：\n${hotList}\n`,
      `请基于以上热点，生成 5 个选题建议。严格输出 JSON 数组。`,
    ].filter(Boolean).join('\n');

    const raw = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    let ideas;
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        ideas = JSON.parse(jsonMatch[0]);
      } else {
        ideas = JSON.parse(raw);
      }
    } catch (parseError) {
      return res.status(500).json({ error: `LLM 返回格式异常，请重试。原始输出长度: ${raw.length}` });
    }

    const valid = ideas.filter(i => i.title && i.angle).map(i => ({
      title: i.title,
      angle: i.angle,
      hotBasis: i.hotBasis || '',
      platform: i.platform || 'all',
      priority: i.priority || 'medium',
      reason: i.reason || '',
      copyType: i.copyType || '图文',
      copy: i.copy || '',
    }));

    res.json({ ideas: valid, hotEvidence: hotItems.length, generatedAt: Date.now() });
  } catch (e) {
    res.status(500).json({ error: `选题生成失败: ${e.message}` });
  }
});

function platformLabel(p) {
  return { dy: '抖音', xhs: '小红书', gzh: '公众号', sph: '视频号', ks: '快手', wb: '微博', zh: '知乎', bd: '百度', bz: 'B站', tt: '头条' }[p] || p;
}

if (DESKTOP_MODE) {
  const distDir = path.join(__dirname, 'dist');
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    console.error('[insprira-lite] 桌面模式缺少 dist/index.html，请先运行 npm run build');
    process.exit(1);
  }
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(indexFile);
  });
}

app.listen(PORT, HOST, () => {
  console.log(`[insprira-lite] 后端服务已启动: http://${HOST}:${PORT}`);
  if (DESKTOP_MODE) console.log(`[insprira-lite] 桌面模式入口: http://${HOST}:${PORT}`);
  console.log(`[insprira-lite] RedFox API: ${REDFOX_API_KEY ? '已配置' : '未配置'}`);
  console.log(`[insprira-lite] LLM: ${LLM_BASE_URL && LLM_API_KEY ? LLM_MODEL : '未配置'}`);
});
