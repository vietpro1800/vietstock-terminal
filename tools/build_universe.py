#!/usr/bin/env python3
"""Sinh js/universe.js: danh sách cổ phiếu niêm yết/đăng ký giao dịch trên HOSE, HNX, UPCoM kèm phân ngành ICB.

Nguồn: data/symbols.json của dự án mã nguồn mở vnstock-js (dữ liệu Vietcap).
Chạy:  python3 tools/build_universe.py [đường-dẫn-symbols.json]
(không truyền đường dẫn thì tự tải từ GitHub). Chỉ là công cụ cập nhật dữ liệu, web không cần chạy nó.
"""
import datetime
import json
import re
import sys
import urllib.request

SRC_URL = 'https://raw.githubusercontent.com/ttqteo/vnstock-js/master/data/symbols.json'
EXCHANGES = {'HSX': 'hose', 'HOSE': 'hose', 'HNX': 'hnx', 'UPCOM': 'upcom'}
OUT = 'js/universe.js'


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding='utf-8') as f:
            rows = json.load(f)
    else:
        with urllib.request.urlopen(SRC_URL, timeout=60) as r:
            rows = json.load(r)

    sectors = {}
    for x in rows:
        ex = EXCHANGES.get(x.get('exchange'))
        sym = x.get('symbol', '')
        # Cổ phiếu có mã 3 ký tự; bỏ chứng quyền, ETF, trái phiếu, phái sinh và mã chưa phân ngành.
        if not ex or not re.fullmatch(r'[A-Z0-9]{3}', sym) or not x.get('sector') or not x.get('industry'):
            continue
        sec = sectors.setdefault(x['sector'], {'en': x.get('sectorEn') or x['sector'], 'industries': {}})
        ind = sec['industries'].setdefault(x['industry'], {'hose': [], 'hnx': [], 'upcom': []})
        ind[ex].append(sym)

    total = 0
    lines = []
    for name, sec in sorted(sectors.items(), key=lambda kv: -sum(len(v) for i in kv[1]['industries'].values() for v in i.values())):
        lines.append("    { id: '%s', name: '%s', industries: [" % (slug(sec['en']), name))
        for iname, ind in sorted(sec['industries'].items(), key=lambda kv: -sum(len(v) for v in kv[1].values())):
            parts = ["name: '%s'" % iname]
            for ex in ('hose', 'hnx', 'upcom'):
                if ind[ex]:
                    parts.append("%s: '%s'" % (ex, ' '.join(sorted(ind[ex]))))
                    total += len(ind[ex])
            lines.append('      { ' + ', '.join(parts) + ' },')
        lines.append('    ] },')

    today = datetime.date.today().isoformat()
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(HEADER.format(updated=today, total=total))
        f.write('\n'.join(lines) + '\n')
        f.write(FOOTER)
    print('Đã ghi %s: %d mã, %d ngành.' % (OUT, total, len(sectors)))


HEADER = """// Danh sách cổ phiếu toàn thị trường (HOSE, HNX, UPCoM) theo phân ngành ICB — {total} mã.
// FILE SINH TỰ ĐỘNG bằng `python3 tools/build_universe.py`, cập nhật {updated}. Không sửa tay.
// Mỗi ngành cấp 2 gồm các ngành cấp 3; mã ghi theo sàn, cách nhau bởi dấu cách.
window.VST = window.VST || {{}};

VST.universe = {{
  updated: '{updated}',
  sectors: [
"""

FOOTER = """  ],
};

// Dựng sẵn: sectors[i].symbols (mọi mã trong ngành), info[mã] = { exchange, sector, industry }, all (mọi mã).
(function (u) {
  u.info = {};
  u.all = [];
  u.count = { hose: 0, hnx: 0, upcom: 0 };
  u.sectors.forEach(function (s) {
    s.symbols = [];
    s.industries.forEach(function (ind) {
      ['hose', 'hnx', 'upcom'].forEach(function (ex) {
        (ind[ex] ? ind[ex].split(' ') : []).forEach(function (sym) {
          if (u.info[sym]) return;
          u.info[sym] = { exchange: ex, sector: s.name, industry: ind.name };
          s.symbols.push(sym);
          u.all.push(sym);
          u.count[ex]++;
        });
      });
    });
  });
})(VST.universe);
"""

if __name__ == '__main__':
    main()
