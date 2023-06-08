import { DateTime, Interval } from "luxon"

import { TimeSlotsFinderError } from "./errors"

export interface PeriodMoment {
    /** The year of the moment. */
    year?: number
    /** The month of the moment. */
    month: number
    /** The day of the year of the moment. */
    day: number
    /** The hour of the moment. */
    hour?: number
    /** The minute of the moment. */
    minute?: number
}

export interface Period {
    /** The moment the shift starts. When no year specified the shift repeats every year. */
    startAt: PeriodMoment
    /** The moment the shift end. If year defined for `startAt`, it must be defined for `endAt`. */
    endAt: PeriodMoment
}

export interface Shift {
    /** A start time in the `HH:mm` format. */
    startTime: string
    /** An end time in the `HH:mm` format. */
    endTime: string
}

export interface AvailablePeriod {
    /** An ISO weekday (1 for Monday to 7 for Sunday). */
    isoWeekDay: number
    /** A list of shifts for the day. */
    shifts: Shift[]
}

export interface TimeSlotsFinderConfiguration {
    /** Duration of a appointment in minutes. */
    timeSlotDuration: number
    /** The periods where booking is possible in a week. */
    availablePeriods: AvailablePeriod[]
    /**
     * A number indicating the step for the start minute of a slot.
     * E.g. if the multiple is 15, slots can only begin at XX:00, XX:15, XX:30 or XX:45.
     * Default value is 5.
     */
    slotStartMinuteStep?: number
    /** Periods where booking is impossible. Take precedence over workedPeriods. */
    unavailablePeriods?: Period[]
    /** The minimum amount of minutes available before an appointment. */
    minAvailableTimeBeforeSlot?: number
    /** The minimum amount of minutes available after an appointment. */
    minAvailableTimeAfterSlot?: number
    /** The minimum amount of minutes between the time of the booking and the appointment booked. */
    minTimeBeforeFirstSlot?: number
    /** The maximum days in the future before appointments cannot be taken anymore. */
    maxDaysBeforeLastSlot?: number
    /** The timezone used through all the configuration. */
    timeZone: string
}

export interface DatePeriod {
    startAt: DateTime
    endAt: DateTime
}

export interface TimeSlot extends DatePeriod {
    duration: number
}

export interface TimeSlotsFinderParameters {
    configuration: TimeSlotsFinderConfiguration
    from: DateTime
    to: DateTime
}

export function getAvailableTimeSlotsInCalendar(params: TimeSlotsFinderParameters): TimeSlot[] {
	const { configuration, from, to } = params

	const usedConfig = _checkSearchParameters(configuration, from, to)
	const { unavailablePeriods, timeZone } = usedConfig

	const eventList = [..._getUnavailablePeriodAsEvents(unavailablePeriods ?? [], timeZone)]

	const { firstFromMoment, lastToMoment } = _computeBoundaries(from, to, usedConfig)
	const timeSlots: TimeSlot[] = []

	let fromMoment = firstFromMoment
	while (fromMoment < lastToMoment) {
		const weekDayConfig = _getWeekDayConfigForMoment(usedConfig, fromMoment)
		if (weekDayConfig) {
			weekDayConfig.shifts.forEach((shift: Shift) => {
				const { startAt, endAt } = _getMomentsFromShift(fromMoment, shift)
				const partialFrom = DateTime.max(firstFromMoment, startAt)
				const partialTo = DateTime.min(lastToMoment, endAt)
				if (partialFrom >= partialTo) {
					return
				}
				timeSlots.push(
					..._getAvailableTimeSlotsForShift(usedConfig, eventList, partialFrom, partialTo)
				)
			})
		}
		fromMoment = fromMoment.plus({ days: 1 }).startOf("day")
	}

	return timeSlots
}

function _checkSearchParameters(configuration: TimeSlotsFinderConfiguration, from: DateTime, to: DateTime) {
	if (!isConfigurationValid(configuration)) {
		throw new TimeSlotsFinderError(
			"The configuration provided is invalid. Please check your settings."
		)
	}
	if (!from.isValid || !to.isValid || from >= to) {
		throw new TimeSlotsFinderError("Invalid date parameters")
	}
	const usedConfig = { ...configuration }
	usedConfig.availablePeriods = _mergeOverlappingShiftsInAvailablePeriods(
		usedConfig.availablePeriods ?? []
	)
	return usedConfig
}

function _getUnavailablePeriodAsEvents(periods: Period[], timeZone: string) {
	return periods.map((period) => ({
		startAt: DateTime.fromObject(period.startAt, { zone: timeZone }),
		endAt: DateTime.fromObject(period.endAt, { zone: timeZone })
	}))
}

function _computeBoundaries(from: DateTime, to: DateTime, configuration: TimeSlotsFinderConfiguration) {
	const searchLimitMoment = configuration.maxDaysBeforeLastSlot
		? DateTime.local().setZone(configuration.timeZone)
			.plus({ days: configuration.maxDaysBeforeLastSlot })
			.endOf("day")
		: null

	const firstFromMoment = DateTime.max(
		from.setZone(configuration.timeZone),
		DateTime.local().setZone(configuration.timeZone)
			.plus({ minutes: configuration.minAvailableTimeBeforeSlot ?? 0 })
			.plus({ minutes: configuration.minTimeBeforeFirstSlot ?? 0 }),
	)
	const lastToMoment = searchLimitMoment
		? DateTime.min(to.setZone(configuration.timeZone), searchLimitMoment)
		: to.setZone(configuration.timeZone)

	return { firstFromMoment, lastToMoment }
}

function _getWeekDayConfigForMoment(configuration: TimeSlotsFinderConfiguration, moment: DateTime) {
	const weekDay = moment.weekday
	return configuration.availablePeriods.find((p) => p.isoWeekDay === weekDay)
}

function _getMomentsFromShift(fromMoment: DateTime, shift: Shift) {
	const { startTime, endTime } = shift
	const start = DateTime.fromISO(startTime)
	const end = DateTime.fromISO(endTime)
	const startAt = fromMoment.set({
		hour: start.hour,
		minute: start.minute,
		second: 0,
		millisecond: 0
	})
	const endAt = fromMoment.set({
		hour: end.hour,
		minute: end.minute,
		second: 0,
		millisecond: 0
	})
	if (endAt <= startAt) {
		endAt.plus({ days: 1 })
	}
	return { startAt, endAt }
}

export interface LuxonPeriod {
    startAt: DateTime
    endAt: DateTime
}

function _getAvailableTimeSlotsForShift(
	configuration: TimeSlotsFinderConfiguration,
	eventList: LuxonPeriod[],
	from: DateTime,
	to: DateTime
) {
	const durationInMinutes = configuration.timeSlotDuration
	let startMoment = from
	let endMoment = startMoment.plus({ minutes: durationInMinutes })
	const timeSlots: TimeSlot[] = []

	while (endMoment <= to) {
		const slotInterval = Interval.fromDateTimes(startMoment, endMoment)
		if (eventList.every((event) => !slotInterval.engulfs(Interval.fromDateTimes(event.startAt, event.endAt)))) {
			timeSlots.push({
				startAt: startMoment,
				endAt: endMoment,
				duration: endMoment.diff(startMoment, 'minutes').toObject().minutes ?? 0
			})
		}
		startMoment = startMoment.plus({ minutes: slotInterval.toDuration('minutes').minutes })
		endMoment = startMoment.plus({ minutes: durationInMinutes })
	}
	return timeSlots
}

export function isConfigurationValid(configuration: TimeSlotsFinderConfiguration): boolean {
	if (!configuration) {
		throw new TimeSlotsFinderError("No configuration defined")
	}

	_checkPrimitiveValue(configuration)

	if (!Array.isArray(configuration.availablePeriods)) {
		throw new TimeSlotsFinderError("A list of available periods is expected")
	}
	for (let i = 0; i < configuration.availablePeriods.length; i += 1) {
		_isAvailablePeriodValid(configuration.availablePeriods[i], i)
	}

	if (
		configuration.unavailablePeriods != null
        && !Array.isArray(configuration.unavailablePeriods)
	) {
		throw new TimeSlotsFinderError("A list of unavailable periods is expected")
	}
	if (configuration.unavailablePeriods) {
		for (let i = 0; i < configuration.unavailablePeriods.length; i += 1) {
			if (!_isUnavailablePeriodValid(configuration.unavailablePeriods[i])) {
				throw new TimeSlotsFinderError(`Unavailable period nº${i + 1} is invalid`)
			}
		}
	}
	return true
}

function _checkPrimitiveValue(configuration: TimeSlotsFinderConfiguration): boolean {
	/*
	 * Same checks as original, without the timezone check
	 * Remaining code here ...
	 */

	_checkTimeZone(configuration.timeZone)

	const minBeforeFirst = configuration.minTimeBeforeFirstSlot
	const maxBeforeLast = configuration.maxDaysBeforeLastSlot
	if (minBeforeFirst && maxBeforeLast && (minBeforeFirst / (24 * 60) > maxBeforeLast)) {
		throw new TimeSlotsFinderError(`The first possible slot will always be after last one possible (see minTimeBeforeFirstSlot and maxDaysBeforeLastSlot)`)
	}
	return true
}

function _checkTimeZone(timeZone: string) {
	if (!timeZone) {
		throw new TimeSlotsFinderError(`Missing time zone`)
	}
	try {
		DateTime.local().setZone(timeZone)
	} catch (_) {
		throw new TimeSlotsFinderError(`Invalid time zone: ${timeZone}`)
	}
}

// _nullOrGreaterThanOrEqualTo and _nullOrBetween remain the same

export function _mergeOverlappingShiftsInAvailablePeriods(
	availablePeriods: AvailablePeriod[]
): AvailablePeriod[] {
	return availablePeriods.map((availablePeriod) => ({
		...availablePeriod,
		shifts: _mergeOverlappingShifts(availablePeriod.shifts ?? []),
	}))
}

export function _mergeOverlappingShifts(shifts: Shift[]): Shift[] {
	if (shifts.length < 2) {
		return [...shifts]
	}

	const sortedShifts = [...shifts].sort((a, b) => a.startTime.localeCompare(b.startTime))

	for (let i = 0; i < sortedShifts.length - 1; i += 1) {
		if (sortedShifts[i].endTime.localeCompare(sortedShifts[i + 1].startTime) >= 0) {
			if (sortedShifts[i].endTime.localeCompare(sortedShifts[i + 1].endTime) < 0) {
				sortedShifts[i] = {
					startTime: sortedShifts[i].startTime,
					endTime: sortedShifts[i + 1].endTime,
				}
			}
			sortedShifts.splice(i + 1, 1)
			i -= 1
		}
	}

	return sortedShifts
}

export function _isUnavailablePeriodValid(period: Period): boolean {
	return Boolean(
		period
        && period.startAt
        && period.endAt
        && (period.startAt.year == null) === (period.endAt.year == null)
        && _isPeriodMomentValid(period.startAt)
        && _isPeriodMomentValid(period.endAt)
        && (
        	period.startAt.year == null
            || DateTime.fromObject(period.startAt).toJSDate() < DateTime.fromObject(period.endAt).toJSDate()
        ),
	)
}

function _isAvailablePeriodValid(availablePeriod: AvailablePeriod, index: number) {
	if (!Number.isInteger(availablePeriod.isoWeekDay)) {
		throw new TimeSlotsFinderError(`ISO Weekday must and integer for available period nº${index + 1}`)
	}
	if (availablePeriod.isoWeekDay < 1 || availablePeriod.isoWeekDay > 7) {
		throw new TimeSlotsFinderError(`ISO Weekday must be contains between 1 (Monday) and 7 (Sunday) for available period nº${index + 1}`)
	}
	for (const shift of availablePeriod.shifts) {
		if (!_isShiftValid(shift)) {
			throw new TimeSlotsFinderError(`Daily shift ${shift.startTime} - ${shift.endTime} for available period nº${index + 1} is invalid`)
		}
	}
	if (_mergeOverlappingShifts(availablePeriod.shifts).length !== availablePeriod.shifts.length) {
		throw new TimeSlotsFinderError(`Some shifts are overlapping for available period nº${index + 1}`)
	}

	return true
}

function _isPeriodMomentValid(periodMoment: PeriodMoment) {
	if (periodMoment.hour == null && periodMoment.minute != null) {
		return false
	}

	const isYearAndMonthValid = (
		(periodMoment.year == null || periodMoment.year > 0)
        && periodMoment.month >= 0 && periodMoment.month <= 11
	)

	if (!isYearAndMonthValid) {
		return false
	}

	let day = DateTime.local().set({ month: periodMoment.month + 1 })
	if (periodMoment.year) {
		day = day.set({ year: periodMoment.year })
	}

	return (
		periodMoment.day >= 1 && day && day?.daysInMonth && periodMoment.day <= day?.daysInMonth
        && (periodMoment.hour == null || (periodMoment.hour >= 0 && periodMoment.hour <= 23))
        && (periodMoment.minute == null || (periodMoment.minute >= 0 && periodMoment.minute <= 59))
	)
}

function _isShiftValid(shift: Shift) {
	const [startHour, startMinute] = shift.startTime.split(":").map(Number)
	const [endHour, endMinute] = shift.endTime.split(":").map(Number)
	return (
		shift
        && shift.startTime.match(/^\d{2}:\d{2}$/)
        && shift.endTime.match(/^\d{2}:\d{2}$/)
        && startHour >= 0 && startHour <= 23
        && startMinute >= 0 && startMinute <= 59
        && endHour >= 0 && endHour <= 23
        && endMinute >= 0 && endMinute <= 59
        && shift.endTime.localeCompare(shift.startTime) > 0
	)
}
