process.env.TZ = 'UTC'
import { getAvailableTimeSlotsInCalendar } from "../src/time-slots-luxon"
import MockDate from "mockdate"
import iCalTestJSON from "./resources/calendar-ical.json"
import { TimeSlotsFinderError } from "../src/errors"
import { DateTime, Interval } from "luxon"
const iCalData = (iCalTestJSON as unknown as { data: string }).data

const baseConfig = {
	timeSlotDuration: 15,
	availablePeriods: [{
		isoWeekDay: 5,
		shifts: [{ startTime: "10:00", endTime: "20:00" }]
	}],
	timeZone: "Europe/Paris",
}

const encompassing1 = {
	startAt: DateTime.fromISO('2022-04-10T05:00:00', { zone: 'Europe/Paris' }).toObject() as { year: number, month: number, day: number },
	endAt: DateTime.fromISO('2022-04-10T06:00:00', { zone: 'Europe/Paris' }).toObject() as { year: number, month: number, day: number }
}

const encompassing2 = {
	startAt: DateTime.fromISO('2022-04-10T00:00:00', { zone: 'Europe/Paris' }).toObject() as { year: number, month: number, day: number },
	endAt: DateTime.fromISO('2022-04-10T10:00:00', { zone: 'Europe/Paris' }).toObject() as { year: number, month: number, day: number }
}

describe("Time Slot Finder", () => {
	beforeEach(() => MockDate.reset())
	afterAll(() => MockDate.reset())
	// This test is linked to _prepareEvents complexity (when filtering events)
	it("should run fast on large calendar data set", () => {
		const start = Date.now()
		getAvailableTimeSlotsInCalendar({
			configuration: {
				timeZone: "Europe/Paris",
				timeSlotDuration: 15,
				availablePeriods: [
					{
						isoWeekDay: 5,
						shifts: [
							{
								startTime: "00:00",
								endTime: "23:59"
							}
						]
					},
					{
						isoWeekDay: 6,
						shifts: [
							{
								startTime: "00:00",
								endTime: "23:59"
							}
						]
					},
					{
						isoWeekDay: 7,
						shifts: [
							{
								startTime: "00:00",
								endTime: "23:59"
							}
						]
					}
				]
			},
			from: DateTime.fromISO("2020-10-01T00:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-20T00:00:00.000+02:00")
		})
		const end = Date.now()
		// Results must be computing withing 1 sec (700ms on last test)
		expect(end - start).toBeLessThan(1000)
	})
	it("should take in account an encompassing timeslot of 2 time slots", () => {
		MockDate.set(new Date("2022-04-04T19:00:00.000Z"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeZone: "Europe/Paris",
				timeSlotDuration: 60,
				availablePeriods: [
					{
						isoWeekDay: 7,
						shifts: [
							{
								startTime: "09:00",
								endTime: "20:00"
							}
						]
					}
				],
				unavailablePeriods: [encompassing2],
				slotStartMinuteStep: 15
			},
			from: DateTime.fromISO("2022-04-10T00:00:00.000+02:00"),
			to: DateTime.fromISO("2022-04-11T00:00:00.000+02:00")
		})
		/**
		 * Encompassing event is from 4 to 14.
		 * To respect available period (9 to 14h15) we should only have a proposal at 14h
		 */
		expect(slots[0].startAt.toISO()).toBe("2022-04-10T08:00:00.000Z")
	})
	it("should take in account an encompassing timeslot", () => {
		MockDate.set(new Date("2022-04-04T19:00:00.000Z"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeZone: "Europe/Paris",
				timeSlotDuration: 15,
				availablePeriods: [
					{
						isoWeekDay: 7,
						shifts: [
							{
								startTime: "09:00",
								endTime: "14:15"
							}
						]
					}
				]
			},
			from: DateTime.fromISO("2022-04-10T00:00:00.000+02:00"),
			to: DateTime.fromISO("2022-04-11T00:00:00.000+02:00")
		})
		/**
		 * Encompassing event is from 4 to 14.
		 * To respect available period (9 to 14h15) we should only have a proposal at 14h
		 */
		expect(slots.length).toBe(1)
		expect(slots[0].startAt.toISO()).toBe("2022-04-10T12:00:00.000Z")
	})
	it("should return slots even without calendar data", () => {
		MockDate.set(new Date("2020-10-14T15:00:00.000Z"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 60,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T15:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T20:00:00.000Z"),
		})
		expect(slots.length).toBe(5)
	})
	it("should handle properly timeSlotDuration parameter", () => {
		MockDate.set(new Date("2020-10-14T15:00:00.000Z"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 45,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T15:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T20:00:00.000Z"),
		})
		console.log(slots)
		slots.forEach((slot) => expect(slot.duration).toBe(45))
		const slots2 = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 15,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T15:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T20:00:00.000Z"),
		})
		slots2.forEach((slot) => expect(slot.duration).toBe(15))
	})
	it("should handle properly slotStartMinuteMultiple parameter", () => {
		MockDate.set(new Date("2020-10-15T15:03:12.592Z"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 10,
				slotStartMinuteStep: 5,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T15:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T16:00:00.000Z"),
		})
		expect(slots.length).toBe(5)
		expect(slots[0].startAt.toISO()).toBe("2020-10-15T15:05:00.000Z")
		expect(slots[1].startAt.toISO()).toBe("2020-10-15T15:15:00.000Z")
		expect(slots[2].startAt.toISO()).toBe("2020-10-15T15:25:00.000Z")
		expect(slots[3].startAt.toISO()).toBe("2020-10-15T15:35:00.000Z")
		expect(slots[4].startAt.toISO()).toBe("2020-10-15T15:45:00.000Z")

		const slots2 = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 10,
				slotStartMinuteStep: 5,
				minAvailableTimeBeforeSlot: 2,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T15:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T16:00:00.000Z"),
		})
		expect(slots2.length).toBe(3)
		expect(slots2[0].startAt.toISO()).toBe("2020-10-15T15:10:00.000Z")
		expect(slots2[1].startAt.toISO()).toBe("2020-10-15T15:25:00.000Z")
		expect(slots2[2].startAt.toISO()).toBe("2020-10-15T15:40:00.000Z")
		const slots3 = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 10,
				slotStartMinuteStep: 15,
				minAvailableTimeBeforeSlot: 5,
				minTimeBeforeFirstSlot: 45,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T16:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T17:00:00.000Z"),
		})
		expect(slots3.length).toBe(4)
		expect(slots3[0].startAt.toISO()).toBe("2020-10-15T16:00:00.000Z")
		expect(slots3[1].startAt.toISO()).toBe("2020-10-15T16:15:00.000Z")
		expect(slots3[2].startAt.toISO()).toBe("2020-10-15T16:30:00.000Z")
		expect(slots3[3].startAt.toISO()).toBe("2020-10-15T16:45:00.000Z")
	})
	it("should use 5 as default for slotStartMinuteMultiple parameter", () => {
		MockDate.set(new Date("2020-10-15T15:03:12.592Z"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				timeSlotDuration: 10,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "12:00", endTime: "22:00" }]
				}],
				timeZone: "Europe/Paris",
			},
			from: DateTime.fromISO("2020-10-15T15:00:00.000Z"),
			to: DateTime.fromISO("2020-10-15T16:00:00.000Z"),
		})
		expect(slots.length).toBe(5)
		expect(slots[0].startAt.toISO()).toBe("2020-10-15T15:05:00.000Z")
		expect(slots[4].startAt.toISO()).toBe("2020-10-15T15:45:00.000Z")
	})
	it("should handle properly minAvailableTimeBeforeSlot parameter", () => {
		MockDate.set(new Date("2020-10-14T15:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				minAvailableTimeBeforeSlot: 10,
			},
			from: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T16:00:00.000+02:00"),
		})
		expect(slots.length).toBe(2)
		expect(slots[0].startAt.toISO())
			.toBe("2020-10-16T15:10:00.000+02:00")
		expect(slots[1].startAt.toISO())
			.toBe("2020-10-16T15:35:00.000+02:00")

		const slots2 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				minAvailableTimeBeforeSlot: 10,
			},
			from: DateTime.fromISO("2020-10-16T15:10:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T16:00:00.000+02:00"),
		})
		expect(slots2.length).toBe(2)
		expect(slots2[0].startAt.toISO())
			.toBe("2020-10-16T15:10:00.000+02:00")
		expect(slots2[1].startAt.toISO())
			.toBe("2020-10-16T15:35:00.000+02:00")
	})
	it("should handle properly minAvailableTimeAfterSlot parameter", () => {
		MockDate.set(new Date("2020-10-14T15:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				minAvailableTimeAfterSlot: 10,
			},
			from: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T16:00:00.000+02:00"),
		})
		expect(slots.length).toBe(2)
		expect(slots[0].startAt.toISO())
			.toBe("2020-10-16T15:00:00.000+02:00")
		expect(slots[1].startAt.toISO())
			.toBe("2020-10-16T15:25:00.000+02:00")

		const slots2 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				minAvailableTimeAfterSlot: 10,
			},
			from: DateTime.fromISO("2020-10-16T15:15:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T16:00:00.000+02:00"),
		})
		/*
		 * In calendar Data, there is an event at 15h and 16h
		 * We excpect an event at 15h15 (15min) but no events then because
		 * it would start at 15h40, finish at 15h55 and break the 10min available rule
		 */
		expect(slots2.length).toBe(1)
		expect(slots2[0].startAt.toISO())
			.toBe("2020-10-16T15:15:00.000+02:00")
	})
	it("should handle properly minTimeBeforeFirstSlot parameter", () => {
		MockDate.set(new Date("2020-10-16T14:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				minTimeBeforeFirstSlot: 2 * 60,
			},
			from: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T18:00:00.000+02:00"),
		})
		expect(slots.length).toBeGreaterThanOrEqual(1)
		expect(slots[0].startAt.toISO())
			.toBe("2020-10-16T16:00:00.000+02:00")
	})
	it("should handle properly maxDaysBeforeLastSlot parameter", () => {
		MockDate.set(new Date("2020-10-15T18:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				maxDaysBeforeLastSlot: 1,
			},
			from: DateTime.fromISO("2020-10-16T19:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-17T11:00:00.000+02:00"),
		})
		expect(slots.length).toBe(4)
		expect(slots[3].startAt.toISO())
			.toBe("2020-10-16T19:45:00.000+02:00")
	})
	it("should handle properly timeZone parameter", () => {
		MockDate.set(new Date("2020-10-15T18:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				timeZone: "UTC",
			},
			from: DateTime.fromISO("2020-10-16T20:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T23:00:00.000+02:00"),
		})
		expect(slots.length).toBe(8)
		expect(slots[7].startAt.toISO())
			.toBe("2020-10-16T19:45:00.000Z")
	})
	it("should handle properly availablePeriods parameter", () => {
		MockDate.set(new Date("2020-10-15T18:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				availablePeriods: [{
					isoWeekDay: 5,
					shifts: [
						{ startTime: "12:00", endTime: "13:00" },
						{ startTime: "15:00", endTime: "16:00" },
					]
				}]
			},
			from: DateTime.fromISO("2020-10-16T00:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T23:59:59.999+02:00"),
		})
		expect(slots.length).toBe(8)
		expect(slots[0].startAt.toISO())
			.toBe("2020-10-16T12:00:00.000+02:00")
		expect(slots[4].startAt.toISO())
			.toBe("2020-10-16T15:00:00.000+02:00")

		const slots2 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [
						{ startTime: "12:00", endTime: "13:00" },
						{ startTime: "15:00", endTime: "16:00" },
					]
				}]
			},
			from: DateTime.fromISO("2020-10-16T00:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T23:59:59.999+02:00"),
		})
		expect(slots2.length).toBe(0)
	})
	it("should handle properly unavailablePeriods parameter", () => {
		MockDate.set(new Date("2020-10-15T18:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				unavailablePeriods: [{
					startAt: { year: 2020, month: 9, day: 16, hour: 12, minute: 30 },
					endAt: { year: 2020, month: 9, day: 16, hour: 14, minute: 0 }
				}],
			},
			from: DateTime.fromISO("2020-10-16T11:30:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
		})
		expect(slots.length).toBe(8)
		expect(slots[0].startAt.toISO())
			.toBe("2020-10-16T11:30:00.000+02:00")
		expect(slots[3].endAt.toISO())
			.toBe("2020-10-16T12:30:00.000+02:00")
		expect(slots[4].startAt.toISO())
			.toBe("2020-10-16T14:00:00.000+02:00")
		expect(slots[7].startAt.toISO())
			.toBe("2020-10-16T14:45:00.000+02:00")

		const slots2 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				unavailablePeriods: [{
					startAt: { year: 2019, month: 9, day: 16, hour: 12, minute: 30 },
					endAt: { year: 2019, month: 9, day: 16, hour: 14, minute: 0 }
				}],
			},
			from: DateTime.fromISO("2020-10-16T11:30:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
		})
		expect(slots2.length).toBe(14)

		const slots3 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				unavailablePeriods: [{
					startAt: { month: 9, day: 16, hour: 12, minute: 30 },
					endAt: { month: 9, day: 16, hour: 14, minute: 0 }
				}],
			},
			from: DateTime.fromISO("2020-10-16T11:30:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
		})
		expect(slots3.length).toBe(8)
		expect(slots3[0].startAt.toISO())
			.toBe("2020-10-16T11:30:00.000+02:00")
		expect(slots3[7].startAt.toISO())
			.toBe("2020-10-16T14:45:00.000+02:00")

		const slots4 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				unavailablePeriods: [{
					startAt: { month: 9, day: 16, hour: 12, minute: 30 },
					endAt: { month: 9, day: 16, hour: 14 }
				}],
			},
			from: DateTime.fromISO("2020-10-16T12:15:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
		})
		expect(slots4.length).toBe(5)
		expect(slots4[0].startAt.toISO())
			.toBe("2020-10-16T12:15:00.000+02:00")
		expect(slots4[1].startAt.toISO())
			.toBe("2020-10-16T14:00:00.000+02:00")

		const slots5 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				availablePeriods: [{
					isoWeekDay: 4,
					shifts: [{ startTime: "10:00", endTime: "20:00" }]
				}, {
					isoWeekDay: 7,
					shifts: [{ startTime: "10:00", endTime: "20:00" }]
				}],
				unavailablePeriods: [{
					startAt: { month: 9, day: 16 },
					endAt: { month: 9, day: 17 }
				}],
			},
			from: DateTime.fromISO("2020-10-15T19:45:00.000+02:00"),
			to: DateTime.fromISO("2020-10-18T10:15:00.000+02:00"),
		})
		expect(slots5.length).toBe(2)
		expect(slots5[0].startAt.toISO())
			.toBe("2020-10-15T19:45:00.000+02:00")
		expect(slots5[1].startAt.toISO())
			.toBe("2020-10-18T10:00:00.000+02:00")

		const slots6 = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				unavailablePeriods: [{
					startAt: { year: 2020, month: 9, day: 16, hour: 16 },
					endAt: { year: 2020, month: 9, day: 16, hour: 17, minute: 30 }
				}],
			},
			from: DateTime.fromISO("2020-10-16T15:45:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T17:45:00.000+02:00"),
		})
		expect(slots6.length).toBe(2)
		expect(slots6[0].startAt.toISO())
			.toBe("2020-10-16T15:45:00.000+02:00")
		expect(slots6[1].startAt.toISO())
			.toBe("2020-10-16T17:30:00.000+02:00")
	})
	it("should throw for invalid from and/or to parameters", () => {
		expect(() => getAvailableTimeSlotsInCalendar({
			configuration: baseConfig,
			from: DateTime.fromISO("2020-10-16T18:30:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
		})).toThrowError(new TimeSlotsFinderError(("Invalid boundaries for the search")))
	})
	it(`should properly overlap minAvailableTimeBeforeSlot and minAvailableTimeAfterSlot`, () => {
		MockDate.set(new Date("2020-10-14T15:00:00.000+02:00"))
		const slots = getAvailableTimeSlotsInCalendar({
			configuration: {
				...baseConfig,
				minAvailableTimeBeforeSlot: 10,
				minAvailableTimeAfterSlot: 15,
			},
			from: DateTime.fromISO("2020-10-16T15:00:00.000+02:00"),
			to: DateTime.fromISO("2020-10-16T17:00:00.000+02:00"),
		})
		expect(slots.length).toBe(4)
		expect(slots[0].startAt.toISO())
			.toBe("2020-10-16T15:00:00.000+02:00")
		expect(slots[1].startAt.toISO())
			.toBe("2020-10-16T15:30:00.000+02:00")
		expect(slots[2].startAt.toISO())
			.toBe("2020-10-16T16:00:00.000+02:00")
		expect(slots[3].startAt.toISO())
			.toBe("2020-10-16T16:30:00.000+02:00")
	})
})
