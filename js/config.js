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
