/* ============================================================
   跑团角色卡画廊 · 前端脚本（app.js）
   三个页面共用这一份，靠"当前是哪一页"决定干什么活。

   本步（小步 3）做到：
     1. 接上云服务客户端（一把钥匙，三个页面共用）
     2. 画廊页：从云端 characters 表读出角色卡，画成卡片墙
     3. 画廊页：一个角色都没有时，显示"添加第一个角色"引导（验收 #1）
   小步 4 做到：
     4. 管理页：把表单里的角色信息写进云端表（验收 #3）
     5. 管理页：改同一张卡时用更新而不是新增（验收 #4）
     6. 详情页：按网址里的编号取出对应角色并显示（验收 #2）
   小步 8 做到：
     7. 角色卡字段按真实 DND 5E 人物卡重构（依据 Percy 提供的
        NekoWorks DND 5E 人物卡 v4.4.0）：
          身份：玩家名 / 职业 / 等级 / 种族 / 阵营
          六属性：力量 / 敏捷 / 体质 / 智力 / 感知 / 魅力
          战斗数值：生命值 HP / 护甲等级 AC
        调整值不存库——它是固定公式算出来的，存进库里反而容易写错。
   小步 9 做到：
     8. 补上「人格四件套 + 外貌描述」（个性 / 理念 / 羁绊 / 缺陷 / 外貌）。
        这是录第一张真实角色卡时发现的缺口——少了它们，
        一张卡只剩数值，读不出"这是个什么人"。

   规则八.1：全部中文注释，命名用简单直白的英文。
   ============================================================ */

/* ---------- 0. 管理口令（小步 6） ---------- */

// 双链接机制：浏览链接人人可看，管理链接才带口令。
//   浏览链接：index.html（发给全团，只读）
//   管理链接：admin.html?key=<下面的口令>（DM 自留，可添加/更新）
// 依据：PRD 功能清单 P1、验收 #3 与 #5（全程无需注册）

// ⚠️ 关于这个做法的边界，如实写在这里（对应 TECH_DESIGN 风险 #1）：
// 网页代码是在浏览器里跑的，任何人按 F12 都能看到源码——
// 所以下面这行口令"挡君子不挡技术高手"：
//   挡得住：误点进管理页的团友、把浏览链接转发给别人时被顺手点到；
//   挡不住：真的会打开源码去看的人。
// MVP 阶段（团内使用、管理链接不外传）够用；
// 要真正的安全得靠账号系统，而账号系统已列入 PRD 的"本期不做"。
var ADMIN_KEY = '2ce3wjnja75q';

// 拼出完整的管理链接，方便在管理页里显示出来给你收藏
var ADMIN_URL = 'admin.html?key=' + ADMIN_KEY;

/**
 * 检查是不是"带着正确口令"进来的。
 * @returns {boolean} 口令正确为 true
 */
function checkAdminKey() {
  return getUrlParam('key') === ADMIN_KEY;
}

/**
 * 口令不对时的处理：把表单藏起来，只留一句说明。
 * 不做成"报错页"，而是温和地把人引回画廊——对方多半只是点错了。
 */
function showNoPermission() {
  var form = document.getElementById('character-form');
  if (form) {
    form.style.display = 'none';
  }
  showMessage('这个页面是 DM 专用的，要从"管理链接"进入才能用。' +
    '看角色卡请回 <a href="index.html">画廊页</a>。', 'error');
}

/* ---------- 1. 接上云服务客户端 ---------- */

// 客户端只创建一次，放在这里供后面所有功能共用。
// 三个值都从 cloud-config.js 里取，不写死在本文件里。
var cloud = null;

// 先确认 SDK 有没有加载出来（小步 7 加固）：
// SDK 现在是本地文件（vendor/workbuddy-cloud-sdk.js），正常不会缺；
// 万一没加载出来，这行日志能第一时间告诉我们是哪一环断了。
if (typeof WorkBuddyCloud === 'undefined') {
  console.error('云服务 SDK 没加载出来，请确认 vendor/workbuddy-cloud-sdk.js 存在');
}

try {
  cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: cloudConfig.endpoint,
    publishableKey: cloudConfig.publishableKey,
  });
  console.log('云服务客户端已接上');
} catch (error) {
  // 连不上云服务时不要静默失败，要留下清晰线索
  console.error('云服务客户端创建失败：', error);
}

/* ---------- 2. 认出当前页面 ---------- */

var currentPage = '未知页';

if (document.getElementById('card-wall')) {
  currentPage = '画廊页';
} else if (document.getElementById('character-form')) {
  currentPage = '管理页';
} else if (document.getElementById('character-name')) {
  currentPage = '详情页';
}

/* ---------- 3. 通用小工具 ---------- */

/**
 * 在页面顶部的提示区显示一条消息。
 * @param {string} text 要显示的文字
 * @param {string} type 'ok'（绿色成功）或 'error'（红色出错）
 */
function showMessage(text, type) {
  var box = document.getElementById('message-box');
  if (!box) {
    alert(text);
    return;
  }
  box.innerHTML = '<div class="message message-' + (type || 'ok') + '">' + text + '</div>';
}

/**
 * 把从数据库取回的时间戳，变成好读的样子。
 * 例如 2026-09-23T02:30:00+00:00 → 2026/09/23 10:30
 * @param {string} text 数据库返回的时间文本
 * @returns {string} 本地时间文本；无法识别时原样返回
 */
function formatTime(text) {
  if (!text) {
    return '';
  }
  var date = new Date(text);
  // isNaN 为真说明这个字符串不是合法时间，原样返回，不硬凑
  if (isNaN(date.getTime())) {
    return text;
  }
  var pad = function (n) {
    // 补零：9 → 09，方便对齐显示
    return n < 10 ? '0' + n : '' + n;
  };
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/**
 * 防止别人往页面里塞 HTML 代码（专业名叫 XSS 攻击）。
 * 做法：把尖括号等符号转成"只显示、不执行"的文字。
 * 规则：凡是来自用户输入的内容，显示前都要过一遍这个函数。
 */
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- 3.5 角色卡字段专用小工具（小步 8） ---------- */

// 六属性的"英文列名 ↔ 中文名"对照表，顺序按规则书固定：
// 力量、敏捷、体质、智力、感知、魅力。
// 管理页读表单、详情页画表格都用这一份，以后要调顺序只改这一处。
var ATTRIBUTE_LIST = [
  { key: 'strength', label: '力量' },
  { key: 'dexterity', label: '敏捷' },
  { key: 'constitution', label: '体质' },
  { key: 'intelligence', label: '智力' },
  { key: 'wisdom', label: '感知' },
  { key: 'charisma', label: '魅力' },
];

/**
 * 按 DND 规则算出属性调整值：⌊(数值 − 10) ÷ 2⌋
 * 例如 18 → +4，11 → +0，8 → −1。
 * 这是规则书里的固定公式，永远不会变，所以不存进数据库。
 * @param {number} score 属性数值
 * @returns {string} 带正负号的调整值；数值缺失时返回空字符串
 */
function formatModifier(score) {
  if (score === null || score === undefined || score === '') {
    return '';
  }
  var value = Number(score);
  if (isNaN(value)) {
    return '';
  }
  var mod = Math.floor((value - 10) / 2);
  return mod >= 0 ? '+' + mod : '' + mod;
}

/**
 * 读出输入框里的数字。
 * 空着就返回 null（存进数据库是"没填"，而不是 0）——
 * 在跑团里 0 分和"没填"是两回事，不能混。
 * @param {string} id 输入框的 id
 * @returns {number|null}
 */
function readNumber(id) {
  var box = document.getElementById(id);
  if (!box) {
    return null;
  }
  var text = box.value.trim();
  if (text === '') {
    return null;
  }
  var value = Number(text);
  return isNaN(value) ? null : value;
}

/**
 * 把数字填进输入框：没填的（null）就留空，不要显示成 0。
 * @param {string} id 输入框的 id
 * @param {number|null} value 要填的值
 */
function fillNumber(id, value) {
  var box = document.getElementById(id);
  if (!box) {
    return;
  }
  box.value = (value === null || value === undefined) ? '' : value;
}

/* ---------- 4. 画廊页：把角色卡画成卡片墙 ---------- */

/**
 * 从云端读出所有角色卡，画到卡片墙上。
 * 依据：PRD 验收 #1（打开就能看到卡片墙；一张卡都没有时给引导文案）
 */
async function loadCardWall() {
  var wall = document.getElementById('card-wall');
  if (!wall) {
    return;
  }

  // 情况一：云服务没接上（SDK 没加载出来、断网、配置缺失）
  if (!cloud) {
    showMessage('云服务组件没加载成功，页面暂时读不到角色卡。' +
      '先刷新一次试试；如果还不行，检查网络是否正常。', 'error');
    wall.innerHTML = '';
    return;
  }

  // 先给个加载提示，避免用户对着空页面发呆
  wall.innerHTML = '<p class="sub-text">正在读取角色卡……</p>';

  var result = await cloud.database
    .from('characters')
    // 画廊墙只需要这几列：立绘、名字，再带上职业和等级做副标题
    .select('id, name, summary, portrait_url, class_name, level')
    .order('created_at', { ascending: false });

  var rows = result.data;
  var error = result.error;

  if (error) {
    showMessage('读取角色卡失败：' + error.message, 'error');
    wall.innerHTML = '';
    return;
  }

  // 情况二：一张卡都没有 —— 显示引导文案（验收 #1 的另一半）
  if (!rows || rows.length === 0) {
    wall.innerHTML =
      '<div class="empty-tip">' +
      '<p>这个团的角色卡还是空的。</p>' +
      '<p><a class="btn" href="admin.html">添加第一个角色</a></p>' +
      '</div>';
    return;
  }

  // 情况三：有卡 —— 一张张拼成卡片
  var html = '';

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    // 链接里带上角色编号，详情页靠它知道该显示哪张卡
    html += '<a class="card" href="character.html?id=' + row.id + '">';

    if (row.portrait_url) {
      // 有立绘：显示图片。alt 是图片加载失败时的替代文字
      html += '<img class="card-img" src="' + escapeHtml(row.portrait_url) +
        '" alt="' + escapeHtml(row.name) + ' 的立绘">';
    } else {
      // 没立绘：显示灰底占位块，画面不会空一块（对应"很多人没图"的痛点）
      html += '<div class="card-img-empty">暂无立绘</div>';
    }

    html += '<div class="card-name">' + escapeHtml(row.name) + '</div>';

    // 名字下面补一行小字：职业 · 等级。两项都没填时整行不出现
    var subParts = [];
    if (row.class_name) {
      subParts.push(row.class_name);
    }
    if (row.level !== null && row.level !== undefined) {
      subParts.push(row.level + ' 级');
    }
    if (subParts.length > 0) {
      html += '<div class="card-sub">' + escapeHtml(subParts.join(' · ')) + '</div>';
    }

    html += '</a>';
  }

  wall.innerHTML = html;
  console.log('画廊墙已渲染，共 ' + rows.length + ' 张卡');
}

/* ---------- 5. 管理页：添加 / 更新角色 ---------- */

/**
 * 从网址里取出参数值。
 * 例如 character.html?id=3 → 取出 "3"
 * @param {string} key 参数名
 * @returns {string} 参数值；没有就返回空字符串
 */
function getUrlParam(key) {
  var params = new URLSearchParams(window.location.search);
  var value = params.get(key);
  return value ? value : '';
}

/**
 * 从输入框里读一段文字。
 * @param {string} id 输入框的 id
 * @returns {string} 去掉首尾空格的内容
 */
function readText(id) {
  var box = document.getElementById(id);
  return box ? box.value.trim() : '';
}

/**
 * 把表单里填的内容收集成一个对象，准备写进数据库。
 * 字段依据：NekoWorks DND 5E 人物卡 v4.4.0
 * @returns {object} 与 characters 表字段一一对应的数据
 */
function readFormData() {
  // 立绘链接留空时不写 null，而是写空字符串——
  // 因为表里这一列不允许为空，空字符串代表"没图"
  var data = {
    name: readText('input-name'),
    summary: readText('input-summary'),
    // 身份
    player_name: readText('input-player'),
    class_name: readText('input-class'),
    level: readNumber('input-level'),
    race: readText('input-race'),
    alignment: readText('input-alignment'),
    // 战斗数值
    hp: readNumber('input-hp'),
    ac: readNumber('input-ac'),
    // 叙事
    background: readText('input-background'),
    // 人格四件套 + 外貌（小步 9）
    personality: readText('input-personality'),
    ideals: readText('input-ideals'),
    bonds: readText('input-bonds'),
    flaws: readText('input-flaws'),
    appearance: readText('input-appearance'),
    portrait_url: readText('input-portrait'),
  };

  // 六属性按对照表批量读，避免把同样的代码写六遍
  for (var i = 0; i < ATTRIBUTE_LIST.length; i++) {
    var key = ATTRIBUTE_LIST[i].key;
    data[key] = readNumber('input-' + key);
  }

  return data;
}

/**
 * 把一行数据库记录里的内容填进表单（改卡场景用）。
 * @param {object} row 从数据库读到的角色记录
 */
function fillForm(row) {
  // 文本类字段
  document.getElementById('input-name').value = row.name || '';
  document.getElementById('input-summary').value = row.summary || '';
  document.getElementById('input-player').value = row.player_name || '';
  document.getElementById('input-class').value = row.class_name || '';
  document.getElementById('input-race').value = row.race || '';
  document.getElementById('input-alignment').value = row.alignment || '';
  document.getElementById('input-background').value = row.background || '';
  document.getElementById('input-personality').value = row.personality || '';
  document.getElementById('input-ideals').value = row.ideals || '';
  document.getElementById('input-bonds').value = row.bonds || '';
  document.getElementById('input-flaws').value = row.flaws || '';
  document.getElementById('input-appearance').value = row.appearance || '';
  document.getElementById('input-portrait').value = row.portrait_url || '';

  // 数字类字段：没填的留空，不要显示成 0
  fillNumber('input-level', row.level);
  fillNumber('input-hp', row.hp);
  fillNumber('input-ac', row.ac);

  // 六属性
  for (var i = 0; i < ATTRIBUTE_LIST.length; i++) {
    var key = ATTRIBUTE_LIST[i].key;
    fillNumber('input-' + key, row[key]);
  }
}

/**
 * 管理页表单的提交处理：把角色写进数据库。
 * 依据：PRD 验收 #3（添加后画廊立刻多一张卡）
 * 规则：网址里带 id 就是"更新那一张"，不带就是"新增一张"（验收 #4）
 */
async function handleFormSubmit(event) {
  // 拦住浏览器的默认提交行为——我们用自己的方式存数据，不刷新页面
  event.preventDefault();

  if (!cloud) {
    showMessage('云服务没接上，暂时存不了。请检查网络后刷新。', 'error');
    return;
  }

  var data = readFormData();

  // 角色名是必填项，浏览器虽会拦，这里再确认一次更稳妥
  if (!data.name) {
    showMessage('角色名不能空着。', 'error');
    return;
  }

  // 网址里带 id → 这次是"改一张已有的卡"
  var editId = getUrlParam('id');
  var isUpdate = editId !== '';

  showMessage(isUpdate ? '正在保存修改……' : '正在保存……', 'ok');

  var result;
  if (isUpdate) {
    // 更新：只改这一张卡（按 id 定位）
    // updated_at 手动写上当前时间作为"最后更新时间"（验收 #4 要求标注时间）
    data.updated_at = new Date().toISOString();
    result = await cloud.database
      .from('characters')
      .update(data)
      .eq('id', editId);
  } else {
    // 新增：数据库会自动填 id 和创建时间
    result = await cloud.database
      .from('characters')
      .insert(data);
  }

  if (result.error) {
    showMessage('保存失败：' + result.error.message, 'error');
    return;
  }

  // 存成功 → 清空表单，并告诉用户接下来能看到什么
  document.getElementById('character-form').reset();

  if (isUpdate) {
    showMessage('已更新「' + escapeHtml(data.name) + '」。' +
      ' <a href="character.html?id=' + editId + '">去看看</a>', 'ok');
  } else {
    showMessage('已添加「' + escapeHtml(data.name) + '」。' +
      ' <a href="index.html">回画廊看看</a>', 'ok');
  }
}

/**
 * 管理页进入时的处理：如果网址带 id，说明是来"改"这张卡的，
 * 就把它的现有内容填进表单，避免从头重打。
 * 依据：PRD 验收 #4（更新即覆盖）
 */
async function loadFormForEdit() {
  var editId = getUrlParam('id');
  if (!editId || !cloud) {
    return;
  }

  var result = await cloud.database
    .from('characters')
    // 用 * 一次读全：更新时要把所有字段都带回去，
    // 漏读哪一列，存回去就会把那一列抹掉（立绘链接最容易中招）
    .select('*')
    .eq('id', editId)
    .single();

  if (result.error || !result.data) {
    showMessage('没找到要修改的角色，可能已被删掉。', 'error');
    return;
  }

  fillForm(result.data);

  showMessage('正在修改「' + escapeHtml(result.data.name) + '」，改完点保存即可。', 'ok');
}

/* ---------- 6. 详情页：显示一张角色卡的完整信息 ---------- */

/**
 * 详情页进入时的处理：按网址里的 id 取出角色，铺到页面上。
 * 依据：PRD 验收 #2（点卡片进详情页，能看到完整信息）
 */
async function loadCharacterDetail() {
  var characterId = getUrlParam('id');

  // 情况一：网址里没带编号（比如直接手打地址进来）
  if (!characterId) {
    showMessage('网址里缺少角色编号，请从画廊页点一张卡进来。', 'error');
    return;
  }

  if (!cloud) {
    showMessage('云服务没接上，暂时读不到这张卡。请检查网络后刷新。', 'error');
    return;
  }

  var result = await cloud.database
    .from('characters')
    .select('*')
    .eq('id', characterId)
    .single();

  // 情况二：查不到这张卡（编号写错，或者卡被删了）
  if (result.error || !result.data) {
    showMessage('没找到这张角色卡，可能编号不对。', 'error');
    document.getElementById('character-name').textContent = '找不到这张卡';
    return;
  }

  var row = result.data;

  // 标题与简介。凡是来自数据库的文字都过一遍 escapeHtml，
  // 避免有人往角色名里塞 HTML 代码（XSS 防护）
  document.getElementById('character-name').textContent = row.name || '（没写名字）';
  document.getElementById('character-summary').textContent = row.summary || '';
  document.getElementById('character-background').textContent = row.background || '（没写背景故事）';

  renderIdentity(row);
  renderAttributes(row);
  renderCombat(row);
  renderTraits(row);
  renderAppearance(row);

  // 时间行：显示"创建于 ..."，如果改过就再补一句"最后更新于 ..."
  var timeText = '';
  if (row.created_at) {
    timeText = '创建于 ' + formatTime(row.created_at);
  }
  if (row.updated_at && row.updated_at !== row.created_at) {
    timeText += ' · 最后更新于 ' + formatTime(row.updated_at);
  }
  document.getElementById('character-time').textContent = timeText;

  // 立绘：有链接就显示图片，没有就显示占位块
  var portraitBox = document.getElementById('character-portrait');
  if (portraitBox) {
    if (row.portrait_url) {
      portraitBox.innerHTML = '<img class="detail-img" src="' +
        escapeHtml(row.portrait_url) + '" alt="' + escapeHtml(row.name) + ' 的立绘">';
    } else {
      portraitBox.innerHTML = '<div class="card-img-empty detail-img">暂无立绘</div>';
    }
  }

  // 顶部标题也跟着换成角色名，浏览器标签页看起来更清楚
  document.title = row.name + ' · 跑团角色卡档案馆';
}

/**
 * 画身份标签：种族 / 职业 / 等级 / 阵营 / 玩家名。
 * 没填的那项就不出现，不会留下一排空白标签。
 * @param {object} row 角色记录
 */
function renderIdentity(row) {
  var box = document.getElementById('character-identity');
  if (!box) {
    return;
  }

  // 按"看卡的人最先想知道什么"的顺序排：是什么、干什么的、几级、什么阵营、谁的卡
  var tags = [];
  if (row.race) {
    tags.push(row.race);
  }
  if (row.class_name) {
    tags.push(row.class_name);
  }
  if (row.level !== null && row.level !== undefined) {
    tags.push(row.level + ' 级');
  }
  if (row.alignment) {
    tags.push(row.alignment);
  }
  if (row.player_name) {
    tags.push('玩家：' + row.player_name);
  }

  var html = '';
  for (var i = 0; i < tags.length; i++) {
    html += '<span>' + escapeHtml(tags[i]) + '</span>';
  }
  box.innerHTML = html;
}

/**
 * 画六属性表：每行"属性名 / 数值 / 调整值"。
 * 调整值现场由公式算出（formatModifier），不读数据库。
 * @param {object} row 角色记录
 */
function renderAttributes(row) {
  var tbody = document.getElementById('character-attributes');
  if (!tbody) {
    return;
  }

  var html = '';
  for (var i = 0; i < ATTRIBUTE_LIST.length; i++) {
    var item = ATTRIBUTE_LIST[i];
    var score = row[item.key];
    // 没填的用破折号占位，比显示 0 更诚实
    var scoreText = (score === null || score === undefined) ? '—' : score;
    var modText = formatModifier(score) || '—';

    html += '<tr>' +
      '<td>' + item.label + '</td>' +
      '<td class="attr-value">' + scoreText + '</td>' +
      '<td class="attr-mod">' + modText + '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

/**
 * 画战斗数值：生命值 HP 和护甲等级 AC。
 * @param {object} row 角色记录
 */
function renderCombat(row) {
  var box = document.getElementById('character-combat');
  if (!box) {
    return;
  }

  var parts = [];
  if (row.hp !== null && row.hp !== undefined) {
    parts.push('生命值 HP：' + row.hp);
  }
  if (row.ac !== null && row.ac !== undefined) {
    parts.push('护甲等级 AC：' + row.ac);
  }

  box.textContent = parts.length > 0 ? parts.join('　｜　') : '（没填）';
}

/**
 * 画"性格与羁绊"四件套：个性 / 理念 / 羁绊 / 缺陷。
 * 空着的那项直接不显示——留一排"（没填）"只是噪音。
 * 四项全空时整节收起来，页面上不留一个空标题。
 * @param {object} row 角色记录
 */
function renderTraits(row) {
  var box = document.getElementById('character-traits-box');
  var list = document.getElementById('character-traits');
  if (!box || !list) {
    return;
  }

  // 对照表：数据库列名 ↔ 页面上显示的中文名
  var items = [
    { key: 'personality', label: '个性' },
    { key: 'ideals', label: '理念' },
    { key: 'bonds', label: '羁绊' },
    { key: 'flaws', label: '缺陷' },
  ];

  var html = '';
  var filled = 0;

  for (var i = 0; i < items.length; i++) {
    var text = row[items[i].key];
    if (!text) {
      continue;
    }
    filled++;
    // 长文本用 escapeHtml 转义后放进 dd，靠 CSS 的 pre-wrap 保留换行
    html += '<div>' +
      '<dt>' + items[i].label + '</dt>' +
      '<dd>' + escapeHtml(text) + '</dd>' +
      '</div>';
  }

  if (filled === 0) {
    box.style.display = 'none';
    return;
  }

  box.style.display = '';
  list.innerHTML = html;
}

/**
 * 画外貌描述。没填时整节隐藏。
 * @param {object} row 角色记录
 */
function renderAppearance(row) {
  var box = document.getElementById('character-appearance-box');
  var text = document.getElementById('character-appearance');
  if (!box || !text) {
    return;
  }

  if (!row.appearance) {
    box.style.display = 'none';
    return;
  }

  box.style.display = '';
  text.textContent = row.appearance;
}

/* ---------- 7. 启动：按当前页面各干各的活 ---------- */

document.addEventListener('DOMContentLoaded', function () {
  console.log('跑团角色卡画廊 · app.js 已加载，当前是：' + currentPage);

  if (currentPage === '画廊页') {
    loadCardWall();
  } else if (currentPage === '管理页') {
    // 先验口令：不是从管理链接进来的，就不给用表单（小步 6）
    if (!checkAdminKey()) {
      showNoPermission();
      return;
    }

    // 表单提交时走我们自己的保存逻辑，而不是浏览器默认行为
    var form = document.getElementById('character-form');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    // 把完整的管理链接显示在页面上，方便收藏（下次直接打开）
    var linkBox = document.getElementById('admin-link');
    if (linkBox) {
      linkBox.textContent = ADMIN_URL;
    }

    // 网址带 id 的话，先把现有内容填进表单（改卡场景）
    loadFormForEdit();
  } else if (currentPage === '详情页') {
    loadCharacterDetail();
  }
});
