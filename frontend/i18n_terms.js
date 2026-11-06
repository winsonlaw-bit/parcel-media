/* NJV 工作台 · 中英术语表（数据驱动标签：邮区地名 / 品类）
 *
 * ⚠️ 地名口径：新加坡有自己的官方英文地名，这里 1:1 使用官方英文写法，
 *    不做字面翻译。例：万礼 = Woodlands、直落布兰雅 = Telok Blangah、
 *    波那维斯达 = Buona Vista、红山 = Redhill、花柏山 = Mount Faber。
 *    邮区中文标签本身是官方地名的音译/意译，本表与之逐词对应。
 *    依据：Singapore Post 官方邮区表 + URA 区域对照。
 *    排序由 lang.js 按长度倒序自动处理（长词优先，避免 汤申/汤申上段 之类的误替）。
 */
(function () {
  // ── 品类（14 类） ──────────────────────────────────────────────
  var CAT_EN = {
    '美妆香水': 'Beauty & Fragrance',
    '鞋包配饰': 'Shoes, Bags & Accessories',
    '食品保健': 'Food & Health',
    '服饰': 'Fashion & Apparel',
    '电子': 'Electronics',
    '家居': 'Home & Living',
    '运动户外': 'Sports & Outdoor',
    '工具五金': 'Tools & Hardware',
    '玩具童品': 'Toys & Baby',
    '图书文具': 'Books & Stationery',
    '宗教清真礼品': 'Religious & Halal Gifts',
    '宠物': 'Pet Supplies',
    '汽摩配件': 'Auto & Motorcycle Parts'
  };

  // ── 品类归因后缀 ────────────────────────────────────────────────
  // Top10 表里 Sephora / Love Bonito 的品类带「(品牌归因)」，
  // 表示该品类归因到品牌本身（100%），不是从描述反推出来的。
  var SUFFIX_EN = {
    '(品牌归因)': ' (brand-attributed)',
    '（品牌归因）': ' (brand-attributed)'
  };

  // ── 地名（新加坡官方英文名） ───────────────────────────────────
  var PLACE_EN = {
    '中央商务区(莱佛士坊)': 'Downtown Core (Raffles Place)',
    '中央商务区(滨海)': 'Downtown Core (Marina)',
    '非标准邮区(待核)': 'Non-standard postal sector (to be verified)',
    '上汤申': 'Upper Thomson',
    '汤申上段': 'Upper Thomson',
    '宏茂桥': 'Ang Mo Kio',
    '碧山': 'Bishan',
    '兀兰': 'Woodlands',
    '万礼': 'Woodlands',
    '实里达': 'Seletar',
    '兀兰/实里达': 'Woodlands/Seletar',
    '海军部': 'Admiralty',
    '马西岭': 'Marsiling',
    '后港': 'Hougang',
    '榜鹅': 'Punggol',
    '盛港': 'Sengkang',
    '实龙岗': 'Serangoon',
    '义顺': 'Yishun',
    '三巴旺': 'Sembawang',
    '蔡厝港': 'Choa Chu Kang',
    '登加': 'Tengah',
    '克兰芝': 'Kranji',
    '林厝港': 'Lim Chu Kang',
    '文礼': 'Boon Lay',
    '大士': 'Tuas',
    '裕廊东': 'Jurong East',
    '裕廊': 'Jurong',
    '先驱': 'Pioneer',
    '淡滨尼': 'Tampines',
    '巴西立': 'Pasir Ris',
    '勿洛': 'Bedok',
    '樟宜': 'Changi',
    '洛央': 'Loyang',
    '大巴窑': 'Toa Payoh',
    '波东巴西': 'Potong Pasir',
    '麦波申': 'MacPherson',
    '阿裕尼': 'Aljunied',
    '巴耶利峇': 'Paya Lebar',
    '友诺士': 'Eunos',
    '芽笼': 'Geylang',
    '加东': 'Katong',
    '如切': 'Joo Chiat',
    '马林百列': 'Marine Parade',
    '东海岸': 'East Coast',
    '女皇镇': 'Queenstown',
    '汤申': 'Thomson',
    '诺维娜': 'Novena',
    '波那维斯达': 'Buona Vista',
    '武吉知马': 'Bukit Timah',
    '东陵': 'Tanglin',
    '荷兰村': 'Holland Village',
    '乌节路': 'Orchard',
    '小印度': 'Little India',
    '武吉士': 'Bugis',
    '美芝路': 'Beach Road',
    '加冷': 'Kallang',
    '红山': 'Redhill',
    '港湾': 'HarbourFront',
    '花柏山': 'Mount Faber',
    '牛车水': 'Chinatown',
    '滨海湾': 'Marina Bay',
    '政府大厦': 'City Hall',
    '莱佛士坊': 'Raffles Place',
    '丹戎巴葛': 'Tanjong Pagar',
    '杨厝港': 'Ulu Pandan',
    '直落布兰雅': 'Telok Blangah'
  };

  var TERMS = {};
  Object.keys(CAT_EN).forEach(function (k) { TERMS[k] = CAT_EN[k]; });
  Object.keys(PLACE_EN).forEach(function (k) { TERMS[k] = PLACE_EN[k]; });
  Object.keys(SUFFIX_EN).forEach(function (k) { TERMS[k] = SUFFIX_EN[k]; });
  window.NJV_TERMS = TERMS;

  /* 属性短句表：placeholder / title / aria-label 这类"看得见但不在文本节点里"的文案。
   * check_lang.py 只检查文本节点，属性会漏；由 lang.js 的 swapAttrs 整句查表处理。
   * key = 中文原文（整句精确匹配），value = 英文。新增中文属性时同步加这里。 */
  var ATTR_EN = {
    '搜索邮区 / 地名 / 6 位邮编…': 'Search district / place name / 6-digit postcode…',
    '品类细分': 'Category breakdown',
    '需求细分': 'Demand breakdown',
    '总结': 'Summary',
    '流量地图': 'Traffic map',
    '简版流量地图': 'Traffic map (simplified)',
    '货主屏': 'Shipper view',
    '配送员屏': 'Driver view',
    '数据底盘': 'Data foundation',
    '怎么用': 'How to use',
    '搜索': 'Search'
  };
  window.NJV_ATTR_EN = ATTR_EN;
})();
