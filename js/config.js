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
  globalAssets: [
    { symbol: 'XAUUSD', label: 'Vàng', name: 'Vàng (USD/ounce)', pair: 'PAXGUSDT', decimals: 2, aliases: ['XAU', 'GOLD', 'VANG'] },
    { symbol: 'BTCUSD', label: 'Bitcoin', name: 'Bitcoin (USD)', pair: 'BTCUSDT', decimals: 2, aliases: ['BTC', 'BITCOIN'] },
    { symbol: 'ETHUSD', label: 'Ethereum', name: 'Ethereum (USD)', pair: 'ETHUSDT', decimals: 2, aliases: ['ETH'] },
    { symbol: 'EURUSD', label: 'EUR/USD', name: 'Tỷ giá EUR/USD', pair: 'EURUSDT', decimals: 4, aliases: ['EUR'] },
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

  // Trang RRG (sức mạnh tương đối ngành).
  rrg: {
    benchmark: 'VNINDEX',
    days: 550,     // số ngày lịch sử tải về (đủ cho khung tuần)
    batchSize: 6,  // số mã gọi song song khi tải cả danh sách ngành
    tails: [4, 8, 12, 20],
    defaultTail: 8,
    // ratio: chu kỳ SMA của RS-Ratio; momentum: số kỳ so sánh RS-Momentum; smooth: EMA làm mượt RS.
    timeframes: {
      D: { label: 'Ngày', ratio: 50, momentum: 10, smooth: 5 },
      W: { label: 'Tuần', ratio: 26, momentum: 4, smooth: 3 },
    },
    // Nhóm ngành và các mã đại diện (vốn hóa / thanh khoản lớn). Sửa danh sách tại đây.
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
  },

  // Chỉ báo mặc định bật.
  defaultIndicators: { ma20: true, ma50: true, ma200: false, bb: false, rsi: true, macd: false },
};

// Supabase Auth. Publishable key là khóa CÔNG KHAI theo thiết kế (thay cho anon key),
// được phép nằm trong code web tĩnh; an toàn dữ liệu dựa vào Row Level Security.
// TUYỆT ĐỐI không đưa khóa secret / service_role vào đây hay bất kỳ file nào khác.
VST.config.supabase = {
  url: 'https://vrotlzkbcedsodbvhbqn.supabase.co',
  publishableKey: 'sb_publishable_96iNlSt5G1o1KBsSazQLgQ_ArrLxOdk',
};
