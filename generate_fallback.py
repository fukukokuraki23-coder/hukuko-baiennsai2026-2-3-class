rooms = ['図書室', '理科室', '美術室', '音楽室']
header = '8/22,部屋,整理番号,予約名（カタカナ）,人数,,8/23,部屋,整理番号,予約名（カタカナ）,人数'

def generate_times(start_h, start_m, slots):
    times = []
    h, m = start_h, start_m
    for _ in range(slots):
        end_m = m + 15
        end_h = h
        if end_m >= 60:
            end_m -= 60
            end_h += 1
        start_str = f"{h}:{m:02d}"
        end_str = f"{end_h}:{end_m:02d}"
        times.append(f"{start_str}－{end_str}")
        m += 20
        if m >= 60:
            m -= 60
            h += 1
    return times

# 8/22: 10:00開始 18枠 (1-72)
times_22 = generate_times(10, 0, 18)
# 8/23: 9:00開始 18枠 (73-144)
times_23 = generate_times(9, 0, 18)

rows = []
for i in range(18):
    for r in range(4):
        num_22 = i * 4 + r + 1
        num_23 = 72 + i * 4 + r + 1
        time_22 = times_22[i] if r == 0 else ''
        time_23 = times_23[i] if r == 0 else ''
        # 全角数字に変換
        def to_fullwidth(n):
            return ''.join(chr(ord(c) + 0xFEE0) for c in str(n))
        fw_22 = to_fullwidth(num_22)
        fw_23 = to_fullwidth(num_23)
        rows.append(f'{time_22},{rooms[r]},{fw_22},,０,,{time_23},{rooms[r]},{fw_23},,０')

print(header)
for row in rows:
    print(row)
