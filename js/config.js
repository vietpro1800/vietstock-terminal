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

  // Chỉ báo mặc định bật.
  defaultIndicators: { ma20: true, ma50: true, ma200: false, bb: false, rsi: true, macd: false },
};
