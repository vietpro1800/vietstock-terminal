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
