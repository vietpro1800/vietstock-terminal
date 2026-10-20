// Cấu hình chung cho toàn ứng dụng.
window.VST = window.VST || {};

VST.config = {
  defaultSymbol: 'HPG',

  // Chu kỳ tự làm mới (ms).
  refreshMs: 30000,

  // Số request gọi song song mỗi nhóm.
  batchSize: 4,

  // 20 mã vốn hóa lớn cho bảng giá.
  boardSymbols: [
    'VCB', 'BID', 'CTG', 'TCB', 'VPB', 'MBB', 'ACB', 'STB', 'SSI', 'HPG',
    'VHM', 'VIC', 'VNM', 'FPT', 'MSN', 'MWG', 'GAS', 'SAB', 'VJC', 'PLX',
  ],

  // Tài sản thế giới xem chung biểu đồ kỹ thuật, dữ liệu từ Binance (public, không cần khóa).
  // pair: cặp trên Binance; decimals: số chữ số thập phân khi hiển thị giá (USD).
  // Vàng dùng PAXG (1 token = 1 ounce vàng London) làm đại diện cho XAU/USD;
  // EUR/USD lấy từ cặp EURUSDT nên có thể lệch nhẹ so với tỷ giá liên ngân hàng.
  // news: từ khóa lọc tin tức (tab Tin tức), không phân biệt hoa thường; từ đầu tiên dùng để tìm trên Google Tin tức.
  globalAssets: [
    { symbol: 'XAUUSD', label: 'Vàng', name: 'Vàng (USD/ounce)', pair: 'PAXGUSDT', decimals: 2, aliases: ['XAU', 'GOLD', 'VANG'], news: ['giá vàng', 'vàng thế giới', 'vàng miếng', 'vàng nhẫn'] },
    { symbol: 'BTCUSD', label: 'Bitcoin', name: 'Bitcoin (USD)', pair: 'BTCUSDT', decimals: 2, aliases: ['BTC', 'BITCOIN'], news: ['bitcoin', 'BTC', 'tiền số', 'tiền mã hóa'] },
    { symbol: 'ETHUSD', label: 'Ethereum', name: 'Ethereum (USD)', pair: 'ETHUSDT', decimals: 2, aliases: ['ETH'], news: ['ethereum', 'ETH'] },
    { symbol: 'EURUSD', label: 'EUR/USD', name: 'Tỷ giá EUR/USD', pair: 'EURUSDT', decimals: 4, aliases: ['EUR'], news: ['tỷ giá EUR', 'đồng euro', 'EUR/USD'] },
  ],

  // Khung thời gian: resolution gửi lên API và số ngày lịch sử cần tải.
  timeframes: {
    '15': { label: '15 phút', resolution: '15', days: 20, intraday: true },
    '60': { label: '1 giờ', resolution: '60', days: 90, intraday: true },
    'D': { label: 'Ngày', resolution: 'D', days: 365 * 3 },
    'W': { label: 'Tuần', resolution: 'D', days: 365 * 10, aggregate: 'week' },
  },
  defaultTimeframe: 'D',

  // Trang backtest.
  backtest: {
    indexSymbol: 'VNINDEX',   // mã chỉ số để so sánh
    defaultCapital: 100000000, // 100 triệu đồng
    warmupDays: 450,          // tải thêm ~15 tháng trước ngày bắt đầu để MA200 có giá trị ngay
  },

  // Trang cảnh báo Mua/Bán theo chiến lược (signals.html, js/signals.js). Chiến lược lấy từ js/backtest.js.
  signals: {
    // Phạm vi quét. featured = VST.config.heatmap.featured; vn30/hnx30 = rổ trong VST.config.priceboard.groups;
    // watchlist = "Danh mục của tôi" trên trang Bảng giá; hose/all = cả sàn (tải lâu).
    scopes: [
      { id: 'featured', label: 'Mã nổi bật' },
      { id: 'vn30', label: 'VN30' },
      { id: 'hnx30', label: 'HNX30' },
      { id: 'watchlist', label: 'Danh mục của tôi (Bảng giá)' },
      { id: 'hose', label: 'Toàn sàn HOSE' },
      { id: 'all', label: 'Toàn thị trường' },
    ],
    defaultScope: 'featured',
    windows: [5, 10, 20, 60], // tín hiệu trong N phiên gần nhất
    defaultWindow: 10,
    defaultStrategies: ['maCross', 'breakout'],
    batchSize: 10,
    refreshMs: 300000,  // tự quét lại trong giờ giao dịch (9:00–15:00, thứ Hai–thứ Sáu)
    realtimeMax: 400,   // số mã nhận giá khớp realtime
  },

  // Trang danh mục giả lập (paper.html): mua/bán theo chiến lược của js/backtest.js, theo dõi lãi/lỗ.
  // Cấu hình mỗi danh mục lưu ở bảng paper_portfolios (Supabase); giao dịch tính lại từ dữ liệu giá.
  paper: {
    maxSymbols: 10,          // số mã tối đa mỗi danh mục (vốn chia đều)
    maxPortfolios: 20,       // khớp với giới hạn trong supabase/schema.sql
    defaultCapital: 100000000,
    refreshMs: 120000,       // tải lại nến ngày (giá vị thế cập nhật realtime qua bảng giá SSI)
  },

  // Trang RRG (sức mạnh tương đối ngành).
  rrg: {
    benchmark: 'VNINDEX',
    days: 550,     // số ngày lịch sử tải về (đủ cho khung tuần)
    batchSize: 10, // số request song song khi tải toàn bộ ~1500 mã
    // Danh sách mã & ngành: toàn bộ HOSE/HNX/UPCoM trong js/universe.js (VST.universe.sectors).
    // Lọc thanh khoản: GTGD trung bình 20 phiên (tỷ đồng) tối thiểu để mã được tính vào chỉ số ngành
    // và hiện trong danh sách mã của ngành (bỏ mã gần như không giao dịch, gây nhiễu).
    liquidity: [0, 1, 5, 20],
    defaultLiquidity: 1,
    maxShown: 30, // khi xem một ngành: chỉ bật sẵn trên biểu đồ N mã thanh khoản cao nhất
    tails: [4, 8, 12, 20],
    defaultTail: 8,
    // ratio: chu kỳ SMA của RS-Ratio; momentum: số kỳ so sánh RS-Momentum; smooth: EMA làm mượt RS.
    timeframes: {
      D: { label: 'Ngày', ratio: 50, momentum: 10, smooth: 5 },
      W: { label: 'Tuần', ratio: 26, momentum: 4, smooth: 3 },
    },
  },

  // Trang bảng giá (priceboard.html), kiểu bảng giá SSI iBoard.
  // Giá trần/sàn tính từ giá tham chiếu theo biên độ sàn (exchange: hose ±7%, hnx ±10%, upcom ±15%).
  priceboard: {
    refreshMs: 30000, // làm mới nến ngày (TC, cao, thấp) và biểu đồ chỉ số; sổ lệnh/khớp lệnh là realtime
    batchSize: 6,
    // Chỉ số ở đầu trang: biểu đồ trong ngày (nến 5 phút) từ VNDirect.
    indices: [
      { symbol: 'VNINDEX', name: 'VN-Index' },
      { symbol: 'VN30', name: 'VN30' },
      { symbol: 'HNX', name: 'HNX-Index' },
      { symbol: 'HNX30', name: 'HNX30' },
      { symbol: 'UPCOM', name: 'UPCoM' },
    ],
    // Rổ chỉ số. Cập nhật khi HOSE/HNX công bố kỳ cơ cấu (6 tháng/lần).
    groups: [
      { id: 'VN30', name: 'VN30', exchange: 'hose', symbols: [
        'ACB', 'BID', 'BSR', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG', 'LPB',
        'MBB', 'MCH', 'MSN', 'MWG', 'SAB', 'SHB', 'SSB', 'SSI', 'STB', 'TCB',
        'TCX', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VPL', 'VRE',
      ] },
      { id: 'HNX30', name: 'HNX30', exchange: 'hnx', symbols: [
        'BVS', 'CAP', 'CEO', 'DHT', 'DTD', 'DVM', 'DXP', 'HGM', 'HUT', 'IDC',
        'IDV', 'L14', 'LAS', 'LHC', 'MBS', 'NTP', 'NVB', 'PLC', 'PSD', 'PVB',
        'PVC', 'PVI', 'PVS', 'SHS', 'SLS', 'TIG', 'TNG', 'VC3', 'VCS', 'VFS',
      ] },
    ],
    // Nhóm ngành rút gọn (mã đại diện vốn hóa / thanh khoản lớn) cho ô "Ngành…" của bảng giá.
    sectors: [
      { id: 'bank', name: 'Ngân hàng', symbols: ['VCB', 'BID', 'CTG', 'TCB', 'VPB', 'MBB', 'ACB', 'STB', 'HDB', 'VIB', 'TPB', 'SHB'] },
      { id: 'sec', name: 'Chứng khoán & Bảo hiểm', symbols: ['SSI', 'VND', 'VCI', 'HCM', 'SHS', 'MBS', 'FTS', 'VIX', 'BVH', 'BMI', 'MIG', 'PVI'] },
      { id: 'realestate', name: 'Bất động sản', symbols: ['VHM', 'VIC', 'VRE', 'NVL', 'PDR', 'DXG', 'KDH', 'NLG', 'DIG', 'CEO', 'NTL'] },
      { id: 'ip', name: 'Khu công nghiệp', symbols: ['KBC', 'IDC', 'SZC', 'BCM', 'VGC', 'SIP', 'LHG', 'NTC'] },
      { id: 'steel', name: 'Thép & Vật liệu', symbols: ['HPG', 'HSG', 'NKG', 'SMC', 'TLH', 'VGS', 'HT1', 'KSB'] },
      { id: 'oil', name: 'Dầu khí', symbols: ['GAS', 'PLX', 'PVD', 'PVS', 'BSR', 'OIL', 'PVC', 'PVB'] },
      { id: 'power', name: 'Điện & Năng lượng', symbols: ['POW', 'REE', 'PC1', 'GEG', 'NT2', 'HDG', 'QTP', 'GEX'] },
      { id: 'tech', name: 'Công nghệ & Viễn thông', symbols: ['FPT', 'CMG', 'VGI', 'CTR', 'FOX', 'ELC', 'ITD'] },
      { id: 'retail', name: 'Bán lẻ', symbols: ['MWG', 'PNJ', 'FRT', 'DGW', 'PET'] },
      { id: 'food', name: 'Thực phẩm & Đồ uống', symbols: ['VNM', 'MSN', 'SAB', 'QNS', 'KDC', 'MCH', 'SBT', 'DBC'] },
      { id: 'rubber', name: 'Cao su & Săm lốp', symbols: ['GVR', 'PHR', 'DPR', 'DRC', 'CSM', 'TRC'] },
      { id: 'chem', name: 'Hóa chất & Phân bón', symbols: ['DGC', 'DCM', 'DPM', 'CSV', 'LAS', 'BFC'] },
      { id: 'build', name: 'Xây dựng & Đầu tư công', symbols: ['CTD', 'HHV', 'VCG', 'LCG', 'FCN', 'C4G', 'CII', 'PLC'] },
      { id: 'seafood', name: 'Thủy sản', symbols: ['VHC', 'ANV', 'IDI', 'FMC', 'MPC', 'CMX'] },
      { id: 'textile', name: 'Dệt may', symbols: ['TCM', 'TNG', 'MSH', 'VGT', 'STK', 'GIL'] },
      { id: 'transport', name: 'Vận tải, Cảng & Hàng không', symbols: ['GMD', 'HAH', 'VSC', 'VOS', 'PVT', 'SCS', 'VJC', 'HVN', 'ACV'] },
    ],
    defaultGroup: 'VN30',
    // Mã có sẵn trong "Danh mục của tôi" lần đầu mở trang.
    defaultWatchlist: ['HPG', 'FPT', 'VCB', 'SSI', 'MWG'],
  },

  // Trang bản đồ nhiệt (heatmap.html). Ngành và sàn của mỗi mã lấy từ js/universe.js (VST.universe).
  heatmap: {
    days: 130,          // số ngày lịch sử tải về (đủ ~85 phiên cho kỳ 3 tháng)
    batchSize: 10,      // số request song song
    cacheMinutes: 10,   // giữ dữ liệu nến trong phiên trình duyệt, chuyển phạm vi/quay lại không tải lại
    valueDays: 5,       // diện tích ô = GTGD bình quân N phiên
    realtimeMax: 400,   // số mã (GTGD lớn nhất) nhận giá khớp realtime qua bảng giá SSI
    // Kỳ so sánh: n phiên; scale giãn ngưỡng màu vì biến động kỳ dài lớn hơn.
    periods: [
      { id: '1d', label: '1 phiên', n: 1, scale: 1 },
      { id: '1w', label: '1 tuần', n: 5, scale: 2 },
      { id: '1m', label: '1 tháng', n: 20, scale: 4 },
      { id: '3m', label: '3 tháng', n: 60, scale: 6 },
    ],
    steps: [1, 2, 3, 5], // ngưỡng % đổi mức màu (× scale của kỳ)
    // Phạm vi: featured = danh sách dưới; hose/hnx/upcom = cả sàn; all = toàn thị trường (~1500 mã, tải lâu).
    scopes: [
      { id: 'featured', label: 'Mã nổi bật' },
      { id: 'hose', label: 'HOSE' },
      { id: 'hnx', label: 'HNX' },
      { id: 'upcom', label: 'UPCoM' },
      { id: 'all', label: 'Toàn thị trường' },
    ],
    defaultScope: 'featured',
    // Mã thanh khoản cao, đại diện các ngành.
    featured: (
      'SHB TCB HDB VPB MBB MSB ACB VCB VIB TPB LPB NVB SSB NAB STB CTG BID EIB OCB BVB ' +
      'KLB ABB VAB SGB PGB BAB VIC VHM NVL VPI DXG CEO KDH VPL VRE DIG TCH PDR NLG KHG ' +
      'HDG HDC NTL SCR DXS AGG CRE HQC ITC IJC NBB QCG VIX SSI VCI VND SHS BVH HCM MBS ' +
      'ORS CTS DSE AAS BVS BSI TCX VCK FTS AGR APG EVS TVS VDS PVI BMI MIG BIC PTI BSR ' +
      'PLX PVT PVS PVD GAS OIL PVC PVB CNG MSN MWG MCH PNJ FRT DGW SBT VNM PET QNS SAB ' +
      'VEA TLG KDC MML BHN VLC FPT CMG VGI CTR ELC ITD FOX VTP SAM HPG HSG NKG TLH SMC ' +
      'VGS HT1 KSB NTP CII VCG GEL CTD HUT HHV PC1 LCG FCN C4G CTI HBC VC3 PLC DCM DPM ' +
      'DDV CSV BFC DGC LAS AAA PAC IDC KBC VGC SZC BCM SIP LHG NTC TIP D2D BAF ANV DBC ' +
      'HAG VHC PAN IDI FMC CMX ASM MPC LTG HNG VJC VSC GMD HAH PVP VOS PHP ACV HVN SCS ' +
      'SGP VTO GEX POW GEE NT2 REE QTP GEG PPC BCG TV2 VSH GVR DPR PHR TRC DRC CSM DHC ' +
      'VTZ EVF HHP BMP DHG IMP DBD TNG MSH TCM VGT STK GIL VPG HAX DPG'
    ).split(' '),
  },

  // Trang lọc cổ phiếu. Danh sách mã = toàn bộ HOSE/HNX/UPCoM trong js/universe.js (VST.universe).
  scan: {
    days: 420,       // số ngày lịch sử tải về (đủ ~250 phiên cho MA200 và đỉnh 52 tuần)
    batchSize: 10,   // số request song song
    cacheMinutes: 10, // giữ kết quả tính trong phiên trình duyệt, tránh tải lại khi quay lại trang
  },

  // Trang đọc báo (news.html, js/reader.js). Báo không cho đọc RSS trực tiếp từ trình duyệt (CORS),
  // nên đi qua proxy công khai — thử lần lượt, proxy nào chạy được thì dùng trước cho các nguồn sau.
  // Nguồn "crawler" (Vietstock, Markettimes, Người Quan Sát, ĐTCK, VnExpress) lấy từ kho news-crawler trên GitHub,
  // không qua proxy nên luôn có tin kể cả khi proxy lỗi.
  reader: {
    refreshMs: 300000,  // tự tải lại 5 phút/lần khi trang đang mở
    cacheMinutes: 4,    // giữ kết quả mỗi nguồn, đổi mục không tải lại
    batchSize: 4,
    pageSize: 40,       // số tin mỗi lần "Xem thêm"
    crawlerDays: 2,
    proxies: [
      { id: 'rss2json', type: 'rss2json', url: 'https://api.rss2json.com/v1/api.json?rss_url=' },
      { id: 'allorigins', type: 'xml', url: 'https://api.allorigins.win/raw?url=' },
      { id: 'codetabs', type: 'xml', url: 'https://api.codetabs.com/v1/proxy/?quest=' },
    ],
    categories: [
      { id: 'all', label: 'Tất cả' },
      { id: 'market', label: 'Chứng khoán' },
      { id: 'business', label: 'Doanh nghiệp' },
      { id: 'macro', label: 'Vĩ mô – Đầu tư' },
      { id: 'finance', label: 'Tài chính – Ngân hàng' },
      { id: 'realestate', label: 'Bất động sản' },
      { id: 'world', label: 'Thế giới' },
    ],
    // Mỗi báo: các feed RSS theo mục. stripTitle: bỏ đuôi tiêu đề (Google Tin tức thêm " - Reuters").
    // noSummary: mô tả của feed không dùng được (Google Tin tức chỉ có link).
    sources: [
      { id: 'vneconomy', name: 'VnEconomy', home: 'https://vneconomy.vn', feeds: [
        { cat: 'market', url: 'https://vneconomy.vn/chung-khoan.rss' },
        { cat: 'finance', url: 'https://vneconomy.vn/tai-chinh.rss' },
        { cat: 'macro', url: 'https://vneconomy.vn/dau-tu.rss' },
        { cat: 'business', url: 'https://vneconomy.vn/nhip-cau-doanh-nghiep.rss' },
        { cat: 'realestate', url: 'https://vneconomy.vn/dia-oc.rss' },
        { cat: 'world', url: 'https://vneconomy.vn/the-gioi.rss' },
      ] },
      { id: 'cafef', name: 'CafeF', home: 'https://cafef.vn', feeds: [
        { cat: 'market', url: 'https://cafef.vn/thi-truong-chung-khoan.rss' },
        { cat: 'business', url: 'https://cafef.vn/doanh-nghiep.rss' },
        { cat: 'macro', url: 'https://cafef.vn/vi-mo-dau-tu.rss' },
        { cat: 'finance', url: 'https://cafef.vn/tai-chinh-ngan-hang.rss' },
        { cat: 'realestate', url: 'https://cafef.vn/bat-dong-san.rss' },
        { cat: 'world', url: 'https://cafef.vn/tai-chinh-quoc-te.rss' },
      ] },
      { id: 'vietstock', name: 'Vietstock', home: 'https://vietstock.vn', feeds: [
        { cat: 'market', url: 'https://vietstock.vn/830/chung-khoan/co-phieu.rss' },
        { cat: 'business', url: 'https://vietstock.vn/737/doanh-nghiep/hoat-dong-kinh-doanh.rss' },
        { cat: 'macro', url: 'https://vietstock.vn/761/kinh-te/vi-mo.rss' },
        { cat: 'world', url: 'https://vietstock.vn/773/the-gioi/chung-khoan-the-gioi.rss' },
      ] },
      { id: 'investing', name: 'Investing', home: 'https://vn.investing.com/news', feeds: [
        { cat: 'market', url: 'https://vn.investing.com/rss/news_25.rss' },
        { cat: 'world', url: 'https://www.investing.com/rss/news_25.rss' },
        { cat: 'macro', url: 'https://www.investing.com/rss/news_14.rss' },
      ] },
      { id: 'reuters', name: 'Reuters', home: 'https://www.reuters.com/business/', stripTitle: ' - Reuters', noSummary: true, feeds: [
        { cat: 'world', url: 'https://news.google.com/rss/search?q=when:2d+site:reuters.com+markets&hl=en-US&gl=US&ceid=US:en' },
        { cat: 'macro', url: 'https://news.google.com/rss/search?q=when:2d+site:reuters.com+economy&hl=en-US&gl=US&ceid=US:en' },
      ] },
      { id: 'bloomberg', name: 'Bloomberg', home: 'https://www.bloomberg.com/markets', feeds: [
        { cat: 'world', url: 'https://feeds.bloomberg.com/markets/news.rss' },
        { cat: 'macro', url: 'https://feeds.bloomberg.com/economics/news.rss' },
      ] },
      { id: 'crawler', name: 'Tổng hợp VN', crawler: true, cat: 'market', home: 'https://github.com/ttqteo/news-crawler' },
    ],
  },

  // Trang Phân tích mã (analysis.html): hội chẩn 6 vai trò, tính trong js/consult.js. Mọi điểm 0–1.
  // lin [a, b]: giá trị = a cho 0 điểm, = b cho 1 điểm, ở giữa tuyến tính (a > b thì đảo chiều).
  consult: {
    // Kết luận xét theo thứ tự (không bù trừ điểm giữa các thẻ):
    // 1) BÁN khi (KỸ THUẬT < sell.tech VÀ giá dưới MA50) HOẶC RỦI RO < sell.risk.
    // 2) MUA khi KỸ THUẬT ≥ gate.tech VÀ RỦI RO ≥ gate.risk VÀ điểm tổng hợp ≥ verdict.buy.
    // 3) Còn lại THEO DÕI.
    sell: { tech: 0.35, risk: 0.3 },
    gate: { risk: 0.3, tech: 0.6 },
    verdict: { buy: 0.55 },
    // Trọng số điểm tổng hợp (tổng = 1).
    weights: { scan: 0.15, tech: 0.35, sr: 0.10, vol: 0.15, risk: 0.25 },
    // sessions: giờ khớp lệnh liên tục (giờ VN, phút từ 0:00) để ước tính KL cả phiên khi phiên hôm nay chưa xong;
    // minFraction: chưa tới tỷ lệ phiên này thì coi như đã qua minFraction (tránh nhân KL quá lớn lúc mới mở cửa).
    scan: {
      volRatio: [0.5, 2], flowWeight: 0.5, period: 20,
      sessions: [[9 * 60, 11 * 60 + 30], [13 * 60, 14 * 60 + 45]], minFraction: 0.1,
    },
    tech: {
      weights: { trend: 0.5, rsi: 0.2, macd: 0.3 },
      maFast: 20, maSlow: 50, rsiPeriod: 14,
      // RSI ≤ low → 0; low…ideal[0] tăng dần; trong ideal → 1; ideal[1]…high giảm về overbought; > high → overbought.
      rsi: { low: 30, ideal: [50, 65], high: 75, overbought: 0.3 },
      // Điểm MACD theo histogram (MACD − tín hiệu) phiên cuối và hướng so với phiên trước.
      macd: { upRising: 1, up: 0.7, downRising: 0.4, down: 0 },
    },
    // breakoutBars: bứt phá đỉnh 20 phiên trong N phiên gần nhất (giá vẫn giữ trên đỉnh cũ) → điểm breakout;
    // uptrendFloor: giá trên MA50 thì điểm tối thiểu này (mã khỏe hay sát đỉnh, không phạt).
    sr: { period: 20, breakout: 0.75, breakoutBars: 3, uptrendFloor: 0.5, ma: 50 },
    vol: { period: 20, sigma: [1.5, 5], valueBn: [1, 50], weightSigma: 0.5 },
    risk: { atrPeriod: 14, atrMult: 2, stopDist: [3, 10], drawdown: [10, 40], weightStop: 0.6, highBars: 250 },
    // Thanh điểm: < low → đỏ, < high → vàng, còn lại xanh.
    colors: { low: 0.4, high: 0.6 },
    // Số ngày dữ liệu nến ngày tải về (cần ≥ 60 phiên; 52 tuần cho mức giảm từ đỉnh).
    days: 400,
  },

  // Chỉ báo mặc định bật.
  defaultIndicators: { ma20: true, ma50: true, ma200: true, bb: false, vp: true, vol: true, rsi: true, macd: false },
};

// Supabase Auth. Publishable key là khóa CÔNG KHAI theo thiết kế (thay cho anon key),
// được phép nằm trong code web tĩnh; an toàn dữ liệu dựa vào Row Level Security.
// TUYỆT ĐỐI không đưa khóa secret / service_role vào đây hay bất kỳ file nào khác.
VST.config.supabase = {
  url: 'https://vrotlzkbcedsodbvhbqn.supabase.co',
  publishableKey: 'sb_publishable_96iNlSt5G1o1KBsSazQLgQ_ArrLxOdk',
};
