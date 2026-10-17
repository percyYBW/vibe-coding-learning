/* ============================================================
   全站公共脚本（Day 9 起是导航高亮；Day 11 追加骰子浮窗）
   ------------------------------------------------------------
   这个文件在六个页面都被引入，所以"只想写一处、全站都生效"
   的东西都放这里。
   规则八.1：中文注释，命名简单直白。
   ============================================================ */

/* ---------- 第一部分：导航高亮 ---------- */
(function () {
  // 把"高亮当前页导航项"这步单独抽出来，方便在多个时机调用
  function markCurrent() {
    // 当前页的名字，从 <body data-page="..."> 读出来
    var currentPage = document.body.getAttribute("data-page");
    if (!currentPage) {
      return; // 没写 data-page 就不做任何事，静默退出
    }

    // 找到导航里名字对得上的那一项，给它加高亮
    var link = document.querySelector('.site-nav a[data-nav="' + currentPage + '"]');
    if (link) {
      link.classList.add("nav-current");
    }
  }

  // 关键：越早执行越好，避免"页面已经出来了、导航高亮才晚半拍补上"的闪烁。
  // 脚本虽然放在 </body> 末尾，但浏览器是从上往下解析的，
  // 跑到这里时导航栏（<nav>）早就解析完了，所以此时高亮是"随页面一起出来"的，不闪。
  // 再补一个兜底：万一脚本因为加载顺序被推迟，等文档完全就绪后再执行一次，
  // 保证高亮一定到位（重复调用没关系，class 只会加一次）。
  markCurrent();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markCurrent);
  }
})();

/* ============================================================
   第二部分：骰子浮窗（Day 11 追加，全站全局组件）
   ------------------------------------------------------------
   DM 和玩家在任何页面都能投骰：右上角一颗 d20 图标按钮，
   点开面板——左列选骰子和数量（左击 +1 / 右击 -1，最少 0），
   底部调加值，按 Roll 后右侧投掷区里扔出【真 3D 多面体骰子】。
   结果 = 所有骰面之和 + 加值。

   3D 实现（Percy 2026-10-02 拍板"要真实体骰子"）：
   - vendor/three.min.js      —— three.js r90（3D 渲染）
   - vendor/cannon.min.js     —— cannon.js（物理引擎，骰子会真弹跳翻滚）
   - vendor/threejs-dice.js   —— 多面体骰子库（d4~d20 七种几何体+面数字，
                                 已补丁：ESM 转全局、D10 支持自定义面文字）
   三个脚本都在"第一次点开面板"时才懒加载，不拖慢页面打开速度。
   掷骰流程是"结果先定"：先随机好每个骰子的点数，物理翻滚只是
   演出，停下时骰面正好是预定的那个数（DiceManager.prepareValues）。
   d100 按跑团惯例 = 两颗 d10（十位 00-90 + 个位 0-9）。
   ============================================================ */
(function () {
  // 支持的骰子种类（按用户习惯的排列顺序：d20 打头，d100 收尾）
  var DIE_TYPES = [20, 4, 6, 8, 10, 12, 100];

  // 每种骰子当前选了几颗（键是面数，值是数量，初始全是 0）
  var counts = {};
  DIE_TYPES.forEach(function (s) { counts[s] = 0; });

  // 本次投掷的加值（可正可负）
  var modifier = 0;

  // 骰子颜色：火漆红棕骰体 + 白字（和网站主题一致）
  var DICE_BACK_COLOR = '#8b3a2f';
  var DICE_FONT_COLOR = '#ffffff';

  // 面板标题用的 d20 图标（SVG 画的二十面骰）
  var D20_SVG =
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<polygon points="50,4 90,27 90,73 50,96 10,73 10,27" fill="#6e2d24"/>' +
    '<polygon points="10,27 50,4 90,27 50,32" fill="#a85446"/>' +
    '<polygon points="50,32 90,27 90,73 77,68" fill="#8b3a2f"/>' +
    '<polygon points="50,32 10,27 10,73 23,68" fill="#7d332a"/>' +
    '<polygon points="23,68 77,68 50,96" fill="#5f261e"/>' +
    '<polygon points="77,68 90,73 50,96" fill="#6e2d24"/>' +
    '<polygon points="23,68 10,73 50,96" fill="#6e2d24"/>' +
    '<polygon points="50,32 77,68 23,68" fill="#c0705f"/>' +
    '<g stroke="#4a1d17" stroke-width="1.5" fill="none" stroke-linejoin="round">' +
    '<polygon points="50,4 90,27 90,73 50,96 10,73 10,27"/>' +
    '<polygon points="50,32 77,68 23,68"/>' +
    '<path d="M50,4 L50,32 M90,27 L50,32 M10,27 L50,32 M90,27 L77,68 M90,73 L77,68 M10,73 L23,68 M10,27 L23,68 M23,68 L50,96 M77,68 L50,96"/>' +
    '</g>' +
    '</svg>';

  // —— 拼出浮窗的 HTML，一次性注入 <body> 末尾 ——
  // 骰子列表按 DIE_TYPES 顺序生成，每个骰子是一个按钮：
  //   左击（click）= 数量 +1；右击（contextmenu）= 数量 -1。
  var listHtml = DIE_TYPES.map(function (s) {
    return '<div class="die-row">' +
      '<button type="button" class="die-chip" data-sides="' + s + '" ' +
      'title="左击 +1，右击 -1">' +
      '<span class="die-label">d' + s + '</span>' +
      '<span class="die-count" data-count="' + s + '">0</span>' +
      '</button>' +
      '</div>';
  }).join('');

  var widget = document.createElement('div');
  widget.id = 'dice-widget';
  widget.innerHTML =
    '<button type="button" class="dice-fab" id="dice-fab" title="骰子浮窗（d20）">' + D20_SVG + '</button>' +
    '<div class="dice-panel" id="dice-panel">' +
    '  <div class="dice-panel-head">' +
    '    <h2>' + D20_SVG + '骰子台</h2>' +
    '    <button type="button" class="dice-close" id="dice-close" title="收起">×</button>' +
    '  </div>' +
    '  <div class="dice-panel-layout">' +
    '    <div class="dice-left">' +
    '      <div class="dice-list">' + listHtml + '</div>' +
    '      <div class="dice-mod-row">' +
    '        <span class="mod-label">加值</span>' +
    '        <button type="button" class="btn mod-btn" id="dice-mod-minus">−</button>' +
    '        <span id="dice-mod-value">+0</span>' +
    '        <button type="button" class="btn mod-btn" id="dice-mod-plus">＋</button>' +
    '      </div>' +
    '      <button type="button" class="btn" id="dice-roll-btn">🎲 Roll</button>' +
    '    </div>' +
    '    <div class="dice-arena" id="dice-arena">' +
    '      <div id="dice-canvas-wrap"></div>' +
    '      <p class="dice-arena-hint" id="dice-arena-hint">在左边点骰子选数量（左击 +1，右击 −1），再按 Roll</p>' +
    '      <p class="dice-total" id="dice-total"></p>' +
    '    </div>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(widget);

  // —— 抓齐面板里要操作的元素 ——
  var fab = document.getElementById('dice-fab');
  var panel = document.getElementById('dice-panel');
  var arena = document.getElementById('dice-arena');
  var canvasWrap = document.getElementById('dice-canvas-wrap');
  var hintEl = document.getElementById('dice-arena-hint');
  var totalEl = document.getElementById('dice-total');
  var rollBtn = document.getElementById('dice-roll-btn');
  var modValue = document.getElementById('dice-mod-value');

  /** 把加值显示刷新成 +2 / -1 / +0 这种带符号的样子 */
  function renderMod() {
    modValue.textContent = (modifier >= 0 ? '+' : '') + modifier;
  }

  /** 把某种骰子的数量徽章刷新（0 时半透明，有数时主色实底） */
  function renderCount(sides) {
    var badge = document.querySelector('.die-count[data-count="' + sides + '"]');
    if (!badge) { return; }
    badge.textContent = String(counts[sides]);
    if (counts[sides] > 0) {
      badge.classList.add('has-dice');
    } else {
      badge.classList.remove('has-dice');
    }
  }

  // —— 开关面板 ——
  function togglePanel() {
    panel.classList.toggle('open');
    // 第一次点开才去加载 3D 库（三个脚本加起来约 680KB，懒加载不拖慢页面）
    if (panel.classList.contains('open') && !sceneReady && !sceneLoading) {
      loadDice3D();
    }
  }
  fab.addEventListener('click', togglePanel);
  document.getElementById('dice-close').addEventListener('click', function () {
    panel.classList.remove('open');
  });

  // 点面板外面自动收起（点在浮窗内部则不受影响）
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('open') && !widget.contains(e.target)) {
      panel.classList.remove('open');
    }
  });

  // —— 选骰子：左击 +1，右击 -1（最少 0）——
  widget.querySelectorAll('.die-chip').forEach(function (chip) {
    var sides = parseInt(chip.getAttribute('data-sides'), 10);

    chip.addEventListener('click', function () {
      counts[sides] += 1;
      renderCount(sides);
    });

    // 右击：浏览器默认会弹右键菜单，先拦掉再减数量
    chip.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (counts[sides] > 0) {
        counts[sides] -= 1;
        renderCount(sides);
      }
    });
  });

  // —— 加值：− / ＋ 两个按钮，可正可负 ——
  document.getElementById('dice-mod-minus').addEventListener('click', function () {
    modifier -= 1;
    renderMod();
  });
  document.getElementById('dice-mod-plus').addEventListener('click', function () {
    modifier += 1;
    renderMod();
  });

  /* ============================================================
     3D 骰子台：懒加载 vendor 脚本 → 建场景 → 物理掷骰
     ============================================================ */
  var sceneLoading = false; // 正在加载 3D 库
  var sceneReady = false;   // 3D 场景就绪
  var renderer, scene, camera, world, rafStarted = false;
  var liveDice = [];        // 当前投掷区里的骰子（每次 Roll 前清掉旧的）

  /** 按顺序加载一个脚本，加载完回调（onerror 给出友好提示） */
  function loadScript(src, next) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = next;
    s.onerror = function () {
      hintEl.textContent = '骰子台脚本加载失败（' + src + '），请刷新重试';
    };
    document.head.appendChild(s);
  }

  /** 第一次点开面板：按顺序加载 three → cannon → dice，然后建 3D 场景 */
  function loadDice3D() {
    sceneLoading = true;
    hintEl.textContent = '骰子台初始化中…（首次约需 1~2 秒）';

    loadScript('vendor/three.min.js', function () {
      loadScript('vendor/cannon.min.js', function () {
        loadScript('vendor/threejs-dice.js', function () {
          initDiceScene();
        });
      });
    });
  }

  /** 建 3D 场景：渲染器、相机、灯光、桌面、四周围墙、物理世界 */
  function initDiceScene() {
    try {
      // 渲染器：透明背景（透出面板底色），开启抗锯齿和阴影
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(arena.clientWidth, arena.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      canvasWrap.appendChild(renderer.domElement);

      scene = new THREE.Scene();

      // 相机：垂直俯视桌面（从正上方往下看），骰子停稳后朝上的面直接对着镜头，
      // 不用歪着头辨认点数（Percy 2026-10-02 要求改成俯视角方便读结果）
      // 注意：视线和默认"上方向"(0,1,0) 平行时 lookAt 会失效，
      // 所以把上方向改成 (0,0,-1)（桌面的"后方"），画面才不会抖动翻转。
      var aspect = arena.clientWidth / arena.clientHeight;
      camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
      camera.position.set(0, 17, 0);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);

      // 灯光：环境光打底 + 一盏带阴影的主灯（斜上方照下来）
      scene.add(new THREE.AmbientLight('#ffffff', 0.45));
      var sun = new THREE.DirectionalLight('#ffffff', 0.6);
      sun.position.set(-6, 12, 6);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 1024;
      sun.shadow.mapSize.height = 1024;
      scene.add(sun);
      // 补光灯：从另一侧照过来，没有阴影，专门让骰子棱边出现一道高光（光泽感）
      var fill = new THREE.DirectionalLight('#fff8ee', 0.45);
      fill.position.set(7, 9, -5);
      scene.add(fill);
      // 顶灯：位置刻意偏离镜头正上方（反射不会直射镜头），给顶面一层淡淡的反光。
      // 注意强度要压低——俯视角下灯太正/太亮会把朝上的面冲成一片白，数字就看不清了
      var top = new THREE.DirectionalLight('#ffffff', 0.18);
      top.position.set(4, 20, 5);
      scene.add(top);

      // 桌面：羊皮纸色，接住骰子的影子
      var floorMat = new THREE.MeshPhongMaterial({ color: '#efe7db', side: THREE.DoubleSide });
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
      floor.receiveShadow = true;
      floor.rotation.x = Math.PI / 2;
      scene.add(floor);

      // 物理世界：重力调大 20 倍（世界尺度小，重力按比例放大才有"沉"的感觉）
      world = new CANNON.World();
      world.gravity.set(0, -9.82 * 20, 0);
      world.broadphase = new CANNON.NaiveBroadphase();
      world.solver.iterations = 16;
      DiceManager.setWorld(world);

      // 物理地面（和可见桌面同高）
      var floorBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Plane(),
        material: DiceManager.floorBodyMaterial
      });
      floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      world.add(floorBody);

      // 四面"隐形围墙"：把骰子弹回桌面范围内，不让它们飞出画面
      addWall(0, 0, -5.5, 0);            // 后墙
      addWall(0, 0, 5.5, Math.PI);       // 前墙
      addWall(-7, 0, 0, Math.PI / 2);    // 左墙
      addWall(7, 0, 0, -Math.PI / 2);    // 右墙

      sceneReady = true;
      hintEl.textContent = '在左边点骰子选数量（左击 +1，右击 −1），再按 Roll';

      // 窗口尺寸变化时，让 3D 画布跟着面板一起缩放
      window.addEventListener('resize', function () {
        if (!renderer) { return; }
        renderer.setSize(arena.clientWidth, arena.clientHeight);
        camera.aspect = arena.clientWidth / arena.clientHeight;
        camera.updateProjectionMatrix();
      });

      startLoop();
    } catch (e) {
      // 大多数是"显卡不支持 WebGL"的情况，给句人话
      hintEl.textContent = '3D 骰子台初始化失败：' + e.message + '（可刷新重试）';
    }
  }

  /** 在指定位置立一面隐形物理墙（rotationY 是墙的朝向） */
  function addWall(x, y, z, rotationY) {
    var wall = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: DiceManager.barrierBodyMaterial
    });
    wall.position.set(x, y, z);
    wall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    world.add(wall);
  }

  /** 渲染主循环：物理走一步 → 把物理状态同步给 3D 模型 → 画一帧 */
  function startLoop() {
    if (rafStarted) { return; }
    rafStarted = true;

    function frame() {
      if (world) {
        world.step(1.0 / 60.0);
        liveDice.forEach(function (item) {
          item.die.updateMeshFromBody();
        });
      }
      if (renderer) {
        renderer.render(scene, camera);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** 按骰子类型造一个 3D 多面体（d100 特殊：返回 null，由调用方拆成两颗 d10） */
  function makeDie(sides) {
    if (sides === 100) { return null; }
    var Cls = { 4: Dice.DiceD4, 6: Dice.DiceD6, 8: Dice.DiceD8,
                10: Dice.DiceD10, 12: Dice.DiceD12, 20: Dice.DiceD20 }[sides];
    return new Cls({ size: 1, backColor: DICE_BACK_COLOR, fontColor: DICE_FONT_COLOR });
  }

  /** 造一颗百分骰的 d10（kind='tens' 面文字 00-90；kind='units' 面文字 0-9） */
  function makePercentDie(kind) {
    var labels = kind === 'tens'
      ? [' ', ' ', '00', '10', '20', '30', '40', '50', '60', '70', '80', '90']
      : [' ', ' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    return new Dice.DiceD10({
      size: 1,
      backColor: DICE_BACK_COLOR,
      fontColor: DICE_FONT_COLOR,
      faceTexts: labels
    });
  }

  /** 把一颗骰子摆到投掷区的起始位置，给它一个"抛出去"的初速度和旋转 */
  function launchDie(die, index) {
    var obj = die.getObject();
    // 摆成一排从空中落下：多颗骰子错开横向位置，避免挤成一团
    var cols = 5;
    var col = index % cols;
    var row = Math.floor(index / cols);
    obj.position.set(-4 + col * 2, 6 + row * 2 + Math.random(), -2 + row * 2);
    obj.quaternion.set(
      (Math.random() * 90 - 45) * Math.PI / 180, 0,
      (Math.random() * 90 - 45) * Math.PI / 180, 0);
    die.updateBodyFromMesh();
    // 初速度：随手一抛的横向散开 + 大角速度（翻滚就是这个转出来的）
    obj.body.velocity.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 4);
    obj.body.angularVelocity.set(
      Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
  }

  /** 清掉上一轮的所有骰子（3D 模型出场景、物理刚体出世界） */
  function clearDice() {
    liveDice.forEach(function (item) {
      scene.remove(item.die.getObject());
      world.remove(item.die.getObject().body);
    });
    liveDice = [];
  }

  // —— 投掷主流程 ——
  function roll() {
    if (!sceneReady) {
      hintEl.textContent = '骰子台还在初始化，马上就好…';
      return;
    }
    if (DiceManager.throwRunning) {
      return; // 上一把还在滚，直接忽略（连续操作不出错的关键）
    }

    // 把当前选中的骰子摊开，比如选了 2 颗 d6 + 1 颗 d20 → [6,6,20]
    var picked = [];
    DIE_TYPES.forEach(function (s) {
      for (var i = 0; i < counts[s]; i++) {
        picked.push(s);
      }
    });

    // 一颗都没选：给个提示，不空投
    if (picked.length === 0) {
      hintEl.textContent = '先在左边点骰子选数量（左击 +1），再按 Roll';
      return;
    }

    rollBtn.disabled = true;
    rollBtn.textContent = '投掷中…';
    totalEl.textContent = '';
    hintEl.textContent = '';

    clearDice();

    // —— 先把每颗骰子的点数随机好（结果先定，物理翻滚只是演出）——
    // entries: { die(3D对象), value(物理引擎用的1~N), display(给人看的面文字), sides }
    var entries = [];
    picked.forEach(function (sides) {
      if (sides === 100) {
        // 百分骰：两颗 d10。十位骰显示 00-90（值 1~10），个位骰显示 0-9（值 1~10）
        var tens = Math.floor(Math.random() * 10) + 1;   // 1~10 → 面文字 (tens-1)*10
        var units = Math.floor(Math.random() * 10) + 1;  // 1~10 → 面文字 units-1
        var v = (tens - 1) * 10 + (units - 1);           // 合成 1~100（00+0=100 的情况：都掷出 1 时是 0？见下）
        // 注：十位 00 + 个位 0 = 100（百分骰惯例）
        if (v === 0) { v = 100; }
        entries.push({ die: makePercentDie('tens'), value: tens, display: '十位', sides: 100 });
        entries.push({ die: makePercentDie('units'), value: units, display: '个位', sides: 100 });
        entries[entries.length - 2].percentInfo = { tens: tens, units: units, total: v };
        entries[entries.length - 1].percentInfo = entries[entries.length - 2].percentInfo;
      } else {
        var value = Math.floor(Math.random() * sides) + 1;
        entries.push({ die: makeDie(sides), value: value, display: String(value), sides: sides });
      }
    });

    // 上场：加进场景和物理世界，摆好起始位置抛出去
    entries.forEach(function (item, i) {
      scene.add(item.die.getObject());
      liveDice.push(item);
      launchDie(item.die, i);
    });

    // 把预定结果交给骰子库：它会让物理翻滚停下时正好停在预定点数上
    DiceManager.prepareValues(entries.map(function (item) {
      return { dice: item.die, value: item.value };
    }));

    // 轮询等物理停稳（throwRunning 归 false），最多等 8 秒兜底
    var waited = 0;
    var timer = setInterval(function () {
      waited += 100;
      var done = !DiceManager.throwRunning || waited >= 8000;
      if (!done) { return; }
      clearInterval(timer);
      showResult(entries);
    }, 100);
  }

  /** 物理停稳后：把每颗的结果和总点数写在投掷区下方 */
  function showResult(entries) {
    var sum = 0;          // 骰面合计（不含加值）
    var nat20 = false;    // 有没有自然 20
    var parts = [];       // 每颗骰子的"名字=点数"

    entries.forEach(function (item) {
      if (item.sides === 100) {
        // 百分骰只报一次总数（两颗骰子共享同一个 percentInfo，用 reported 标记去重）
        if (!item.percentInfo.reported) {
          item.percentInfo.reported = true;
          parts.push('d100=' + item.percentInfo.total);
          sum += item.percentInfo.total;
        }
      } else {
        parts.push('d' + item.sides + '=' + item.display);
        sum += item.value;
        if (item.sides === 20 && item.value === 20) {
          nat20 = true;
        }
      }
    });

    var total = sum + modifier;
    totalEl.textContent = parts.join('、') + ' ｜ 骰面合计 ' + sum +
      ' ＋ 加值 ' + (modifier >= 0 ? '+' + modifier : modifier) +
      ' ＝ 总点数 ' + total + (nat20 ? '（含自然 20，大成功！）' : '');

    // —— 可重复：按钮恢复，随时再投 ——
    rollBtn.disabled = false;
    rollBtn.textContent = '🎲 再 Roll 一次';
  }

  rollBtn.addEventListener('click', roll);
})();
