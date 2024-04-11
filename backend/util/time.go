package util

import "time"

func GetCSTTime() time.Time {

	cstTime := time.Now().In(GetCSTTimeLocation())

	return cstTime
}

func GetCSTTimeLocation() *time.Location {
	return time.FixedZone("CST", 8*3600)
}

func PrintTime(t time.Time) {
	print(t.Format("2006-01-02 15:04:05 "))
	// 打印时区
	println(t.Location().String())
}

func GetCSTFixedPeriodTime(
	period string,
	period_amount int,
	period_offset int,
) (time.Time, time.Time) {
	now := GetCSTTime()
	var start_time time.Time
	var end_time time.Time
	switch period {
	case "minute":
		// now 的秒数置为0
		now = time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), 0, 0, GetCSTTimeLocation())
		// 取到offset*amount分钟前的起点
		start_time = now.Add(-1 * time.Duration(period_offset*period_amount) * time.Minute)
		end_time = start_time.Add(time.Duration(period_amount) * time.Minute)
	case "hour":
		// now 的分钟和秒数置为0
		now = time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, GetCSTTimeLocation())
		// 取到offset*amount小时前的起点
		start_time = now.Add(-1 * time.Duration(period_offset*period_amount) * time.Hour)
		end_time = start_time.Add(time.Duration(period_amount) * time.Hour)
	case "day":
		// now 的小时、分钟和秒数置为0
		now = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, GetCSTTimeLocation())
		// 取到offset*amount天前的起点
		start_time = now.Add(-1 * time.Duration(period_offset*period_amount) * 24 * time.Hour)
		end_time = start_time.Add(time.Duration(period_amount) * 24 * time.Hour)
	case "month":
		// now 的天、小时、分钟和秒数置为0
		now = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, GetCSTTimeLocation())
		// 取到offset*amount月前的起点
		start_time = now.AddDate(0, -1*period_offset*period_amount, 0)
		end_time = start_time.AddDate(0, period_amount, 0)
	case "year":
		// now 的月、天、小时、分钟和秒数置为0
		now = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, GetCSTTimeLocation())
		// 取到offset*amount年前的起点
		start_time = now.AddDate(-1*period_offset*period_amount, 0, 0)
		end_time = start_time.AddDate(period_amount, 0, 0)
	}

	return start_time, end_time
}
