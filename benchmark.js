const Benchmark = require("benchmark")
const {DateTime} = require("luxon");
const getAvailableTimeSlotsInCalendarA = require("./lib/time-slots-dayjs").getAvailableTimeSlotsInCalendar
const getAvailableTimeSlotsInCalendarB = require("./lib/time-slots-luxon").getAvailableTimeSlotsInCalendar

const suite = new Benchmark.Suite("formats", {
	minSamples: 1000,
	onError: (event) => console.log(event.target.error),
})

const configA = {
	configuration: {
		timeSlotDuration: 15,
		minAvailableTimeBeforeSlot: 5,
		minTimeBeforeFirstSlot: 48 * 60, // 48 hours in minutes
		availablePeriods: [{
			isoWeekDay: 5,
			shifts: [{ startTime: "10:00", endTime: "20:00" }]
		}, {
			isoWeekDay: 6,
			shifts: [
				{ startTime: "10:00", endTime: "20:00" },
			]
		}],
		timeZone: "Europe/Paris",
	},
	from: new Date("2023-09-21T00:00:00.000+02:00"),
	to: new Date("2023-11-12T23:59:59.999+02:00"),
}
const configB = {
	...configA,
	from: DateTime.fromISO("2023-09-21T00:00:00.000+02:00"),
	to:  DateTime.fromISO("2023-11-12T23:59:59.999+02:00"),
}
suite
	.add("luxon", () => {
		getAvailableTimeSlotsInCalendarB(configB)
	})
	.add("dayjs", () => {
		getAvailableTimeSlotsInCalendarA(configA)
	})
	.on("cycle", (event) => {
		console.log(String(event.target))
	})
	.on("complete", function() {
		console.log(`Fastest is ${this.filter("fastest").map("name")}`)
	})
	.on("error", console.log)
	.run({ async: true })
