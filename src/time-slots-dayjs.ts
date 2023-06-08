import dayjs, {Dayjs} from "dayjs"

import utc from "dayjs/plugin/utc"
import timezone from "dayjs/plugin/timezone"
import customParseFormat from "dayjs/plugin/customParseFormat"
import isoWeek from "dayjs/plugin/isoWeek"
import isSameOrBefore from "dayjs/plugin/isSameOrBefore"
import minMax from "dayjs/plugin/minMax"
import objectSupport from "dayjs/plugin/objectSupport"
import {TimeSlotsFinderError} from "./errors"

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)
dayjs.extend(isoWeek)
dayjs.extend(isSameOrBefore)
dayjs.extend(minMax)
dayjs.extend(objectSupport)

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

export interface DayjsPeriod {
    startAt: Dayjs
    endAt: Dayjs
}

export interface DatePeriod {
    startAt: Date
    endAt: Date
}

export interface TimeSlot extends DatePeriod {
    duration: number
}

export interface TimeSlotsFinderParameters {
    /** The configuration specifying the rules used to find availabilities. */
    configuration: TimeSlotsFinderConfiguration
    /** The date from which searching time slots. */
    from: Date
    /** The date to which searching time slots. */
    to: Date
}

/**
 * Extract available time slots from a calendar. Take a configuration to precise rules used to
 * search availabilities. If the configuration provided is invalid, an error will be thrown.
 * @throws TimeSlotsFinderError
 * @param {TimeSlotsFinderParameters} params
 * @return {TimeSlot[]}
 */
export function getAvailableTimeSlotsInCalendar(params: TimeSlotsFinderParameters): TimeSlot[] {
    const {configuration, from, to} = params

    const usedConfig = _checkSearchParameters(configuration, from, to)
    const {unavailablePeriods, timeZone} = usedConfig

    const eventList = [..._getUnavailablePeriodAsEvents(unavailablePeriods ?? [], timeZone)]

    const {firstFromMoment, lastToMoment} = _computeBoundaries(from, to, usedConfig)

    const timeSlots: TimeSlot[] = []

    let fromMoment = firstFromMoment
    while (fromMoment.isBefore(lastToMoment)) {
        // Retrieve availablePeriods shifs for the given weekday
        const weekDayConfig = _getWeekDayConfigForMoment(usedConfig, fromMoment)
        if (weekDayConfig) {
            /* Go through each shift of the week day */
            weekDayConfig.shifts.forEach((shift: Shift) => {
                const {startAt, endAt} = _getMomentsFromShift(fromMoment, shift)
                /* Ensure that shift boundaries don't exceed global boundaries */
                const partialFrom = dayjs.max(firstFromMoment, startAt)
                const partialTo = dayjs.min(lastToMoment, endAt)
                if (!partialFrom.isSameOrBefore(partialTo)) {
                    /* That may happen when shift boundaries exceed global ones */
                    return
                }
                timeSlots.push(
                    ..._getAvailableTimeSlotsForShift(usedConfig, eventList, partialFrom, partialTo)
                )
            })
        }
        /* Go one day forward: all shifts for this day has been processed (if any) */
        fromMoment = fromMoment.add(1, "day").startOf("day")
    }

    return timeSlots
}

function _checkSearchParameters(
    configuration: TimeSlotsFinderConfiguration,
    from: Date,
    to: Date,
): TimeSlotsFinderConfiguration {
    if (!from || !to || from.getTime() > to.getTime()) {
        throw new TimeSlotsFinderError("Invalid boundaries for the search")
    }

    let usedConfig = configuration
    try {
        const formattedPeriods = _mergeOverlappingShiftsInAvailablePeriods(
            configuration.availablePeriods
        )
        usedConfig = {...configuration, availablePeriods: formattedPeriods}
    } catch (_) {
        /* If workedPeriods aren't formatted well and provoke an error, the validation will fail */
    }
    /* Don't go further if configuration is invalid */
    isConfigurationValid(usedConfig)
    return usedConfig
}

function _computeBoundaries(from: Date, to: Date, configuration: TimeSlotsFinderConfiguration) {
    const searchLimitMoment = configuration.maxDaysBeforeLastSlot
        ? dayjs().tz(configuration.timeZone)
            .add(configuration.maxDaysBeforeLastSlot, "day")
            .endOf("day")
        : null

    const firstFromMoment = dayjs.max(
        dayjs(from).tz(configuration.timeZone),
        dayjs().tz(configuration.timeZone)
            /* `minAvailableTimeBeforeSlot` will be subtract later and it cannot start before now */
            .add(configuration.minAvailableTimeBeforeSlot ?? 0, "minute")
            .add(configuration.minTimeBeforeFirstSlot ?? 0, "minute"),
    )
    const lastToMoment = searchLimitMoment
        ? dayjs.min(dayjs(to).tz(configuration.timeZone), searchLimitMoment)
        : dayjs(to).tz(configuration.timeZone)

    return {firstFromMoment, lastToMoment}
}

function _getWeekDayConfigForMoment(
    configuration: TimeSlotsFinderConfiguration,
    searchMoment: Dayjs,
) {
    return (
        configuration.availablePeriods.find((p) => p.isoWeekDay === searchMoment.isoWeekday())
        || null
    )
}

function _getMomentsFromShift(fromMoment: Dayjs, shift: Shift) {
    let startAt = fromMoment.clone()
    startAt = startAt.hour(parseInt(shift.startTime.slice(0, 2), 10))
    startAt = startAt.minute(parseInt(shift.startTime.slice(3), 10))

    let endAt = fromMoment.clone()
    endAt = endAt.hour(parseInt(shift.endTime.slice(0, 2), 10))
    endAt = endAt.minute(parseInt(shift.endTime.slice(3), 10))

    return {startAt, endAt}
}

function _getAvailableTimeSlotsForShift(
    configuration: TimeSlotsFinderConfiguration,
    eventList: DayjsPeriod[],
    from: Dayjs,
    to: Dayjs,
) {
    const timeSlots: TimeSlot[] = []
    const minTimeWindowNeeded = _getMinTimeWindowNeeded(configuration)

    const minAvailableTimeBeforeSlot = configuration.minAvailableTimeBeforeSlot ?? 0
    const minAvailableTimeAfterSlot = configuration.timeSlotDuration
        + (configuration.minAvailableTimeBeforeSlot ?? 0)

    // Ensures we preserve minAvailableTimeBeforeSlot before the first slot
    let searchMoment = from.subtract(minAvailableTimeBeforeSlot, "minute")
    /*
     *  Ensures we don't create an event that would finish after "to" boundary
     *  or break minAvailableTimeBeforeSlot
     */
    const searchEndMoment = to.subtract(minAvailableTimeAfterSlot, "minute")

    /*
     *  We can safely ignore calendar events outside from/to boundaries
     *  We extend this boundaries to take in account minAvailableTimeBeforeSlot
     */
    const filteringMin = from.subtract(minAvailableTimeBeforeSlot, "minute")
    const filteringMax = to.add(minAvailableTimeAfterSlot, "minute")
    const cleanedList: DayjsPeriod[] = _prepareEvents(eventList, filteringMin, filteringMax)

    /* Find index of the first event that is not yet ended at searchMoment */
    let eventIndex = cleanedList.findIndex((event) => event.endAt.isAfter(searchMoment))
    while (searchMoment.isSameOrBefore(searchEndMoment)) {
        const focusedEvent: DayjsPeriod | null = (eventIndex >= 0 && cleanedList[eventIndex]) || null
        /* Adjust searchMoment according to the slotStartMinuteMultiple param */
        searchMoment = _nextSearchMoment(searchMoment, configuration)

        const freeTimeLimitMoment = searchMoment.add(minTimeWindowNeeded, "minute")

        if (focusedEvent?.startAt.isBefore(freeTimeLimitMoment)) {
            /**
             * If first event that is not yet ended start to soon to get a slot at this time,
             * go directly to the end of the event for next search.
             */
            searchMoment = focusedEvent.endAt.clone()
            if (focusedEvent) {
                eventIndex += 1
            }
        } else {
            const {newSearchMoment, timeSlot} = _pushNewSlot(searchMoment, configuration)
            timeSlots.push(timeSlot)
            searchMoment = newSearchMoment
        }
    }
    return timeSlots
}

/*
 * Filter events time boundaries (to enhance performance)
 * then sort by startDate (to make binary sort possible)
 * then filter encompassed events (using binary search)
 */
function _prepareEvents(periods: DayjsPeriod[], from: Dayjs, to: Dayjs) {
    const filteredPeriods = _filterPeriods(periods, from, to)
    const sortedPeriods = _sortPeriods(filteredPeriods)
    return sortedPeriods.filter((event) => !_findEmcompassingEvent(sortedPeriods, event))
}

/* Comparison function to sort DayjsPeriod on start date */
function _sortPeriods(periods: DayjsPeriod[]) {
    return periods.sort((a, b) => (a.startAt.isAfter(b.startAt) ? 1 : -1))
}

/* Filter DayjsPeriod which are strictly outside the provided boundaries */
function _filterPeriods(periods: DayjsPeriod[], from: Dayjs, to: Dayjs) {
    return periods.filter((period) => period.startAt.isBefore(to)
        && period.endAt.isAfter(from))
}

/* Uses a sorted search technique. Event list must be sorted on event.startAt */
function _findEmcompassingEvent(eventList: DayjsPeriod[], event: DayjsPeriod): boolean {
    for (const currentEvent of eventList) {
        // Found condition
        if (currentEvent.startAt.isSameOrBefore(event.startAt)
            && currentEvent.endAt.isAfter(event.endAt)) {
            return true
            // Stop if outside boundaries
        } else if (currentEvent.startAt.isAfter(event.startAt)) {
            return false
        }
    }
    return false
}

function _getMinTimeWindowNeeded(configuration: TimeSlotsFinderConfiguration) {
    return (
        (configuration.minAvailableTimeBeforeSlot ?? 0)
        + configuration.timeSlotDuration
        + (configuration.minAvailableTimeAfterSlot ?? 0)
    )
}

function _pushNewSlot(
    searchMoment: Dayjs,
    configuration: TimeSlotsFinderConfiguration,
): { newSearchMoment: Dayjs, timeSlot: TimeSlot } {
    const startAt = searchMoment
        .add(configuration.minAvailableTimeBeforeSlot ?? 0, "minute")
    const endAt = startAt.add(configuration.timeSlotDuration, "minute")
    const timeSlot = {
        startAt: startAt.toDate(),
        endAt: endAt.toDate(),
        duration: endAt.diff(startAt, "minute"),
    }
    /**
     * We should start searching after just created slot (including free time after it) but before
     * next one free time before it (since the search algorithm take it in account).
     */
    const minutesBeforeNextSearch = Math.max(
        (configuration.minAvailableTimeAfterSlot ?? 0)
        - (configuration.minAvailableTimeBeforeSlot ?? 0),
        0
    )
    return {
        newSearchMoment: endAt
            .add(minutesBeforeNextSearch, "minute"),
        timeSlot
    }
}

function _getUnavailablePeriodAsEvents(unavailablePeriods: Period[], timeZone: string) {
    return unavailablePeriods.map((unavailablePeriod) => {
        /* Transit through string since dayjs.tz with object parsing is bugged */
        const startAtString = dayjs(unavailablePeriod.startAt as never).format("YYYY-MM-DD HH:mm")
        let startAt = dayjs.tz(startAtString, timeZone)
        const endAtString = dayjs(unavailablePeriod.endAt as never).format("YYYY-MM-DD HH:mm")
        let endAt = dayjs.tz(endAtString, timeZone)

        /* If no hours defined, use full days */
        if (unavailablePeriod.startAt.hour == null) {
            startAt = startAt.startOf("day")
        }
        if (unavailablePeriod.endAt.hour == null) {
            endAt = endAt.endOf("day")
        }

        /* Can only happen if no years were defined: push endAt to next year */
        if (endAt.isBefore(startAt)) {
            endAt = endAt.add(1, "year")
        }
        return {startAt, endAt}
    })
}

function _nextSearchMoment(moment: Dayjs, configuration: TimeSlotsFinderConfiguration): Dayjs {
    /* Round up to the next minute if second value is not 0 */
    const nextMoment = moment.second() !== 0
        ? moment.startOf("minute").add(1, "minute")
        : moment.clone()
    const slotStartAt = nextMoment.add(configuration.minAvailableTimeBeforeSlot ?? 0, "minute")
    const slotStartMinuteStep = configuration.slotStartMinuteStep ?? 5
    const minuteToAdd = (
        slotStartMinuteStep - (slotStartAt.minute() % slotStartMinuteStep)
    ) % slotStartMinuteStep
    return nextMoment.add(minuteToAdd, "minute").millisecond(0)
}

/**
 * Check the validity of a configuration for the time-slots service. If the configuration is
 * invalid, an error will be thrown to describe how it's invalid.
 * @throws {TimeSlotsFinderError}
 * @param {TimeSlotsFinderConfiguration} configuration
 * @return {boolean}
 */
export function isConfigurationValid(configuration: TimeSlotsFinderConfiguration): boolean {
    if (!configuration) {
        throw new TimeSlotsFinderError("No configuration defined")
    }

    /* Primitive values */
    _checkPrimitiveValue(configuration)

    /* Worked periods */
    if (!Array.isArray(configuration.availablePeriods)) {
        throw new TimeSlotsFinderError("A list of available periods is expected")
    }
    for (let i = 0; i < configuration.availablePeriods.length; i += 1) {
        _isAvailablePeriodValid(configuration.availablePeriods[i], i)
    }

    /* Unworked periods */
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
    if (configuration.timeSlotDuration == null || configuration.timeSlotDuration < 1) {
        throw new TimeSlotsFinderError(`Slot duration must be at least 1 minute`)
    }
    if (!_nullOrBetween(1, 30, configuration.slotStartMinuteStep)) {
        throw new TimeSlotsFinderError(`Slot start minute step must be contained between 1 and 30`)
    }
    if (!_nullOrGreaterThanOrEqualTo(0, configuration.minAvailableTimeBeforeSlot)) {
        throw new TimeSlotsFinderError(`Time before a slot must be at least 0 minutes`)
    }
    if (!_nullOrGreaterThanOrEqualTo(0, configuration.minAvailableTimeAfterSlot)) {
        throw new TimeSlotsFinderError(`Time after a slot must be at least 0 minutes`)
    }
    if (!_nullOrGreaterThanOrEqualTo(0, configuration.minTimeBeforeFirstSlot)) {
        throw new TimeSlotsFinderError(`The number of minutes before first slot must be 0 or more`)
    }
    if (!_nullOrGreaterThanOrEqualTo(1, configuration.maxDaysBeforeLastSlot)) {
        throw new TimeSlotsFinderError(`The number of days before latest slot must be at least 1`)
    }
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
        dayjs().tz(timeZone)
    } catch (_) {
        throw new TimeSlotsFinderError(`Invalid time zone: ${timeZone}`)
    }
}

function _nullOrGreaterThanOrEqualTo(limit: number, value?: number): boolean {
    return value == null || value >= limit
}

function _nullOrBetween(min: number, max: number, value?: number): boolean {
    return value == null || (value >= min && value <= max)
}

/**
 * Return a reformatted array of availablePeriods without overlapping shifts. Not mutating the
 * originals data.
 * @param {AvailablePeriod[]} availablePeriods The array of availablePeriods to reformat
 * @return {AvailablePeriod[]}
 */
export function _mergeOverlappingShiftsInAvailablePeriods(
    availablePeriods: AvailablePeriod[]
): AvailablePeriod[] {
    return availablePeriods.map((availablePeriod) => ({
        ...availablePeriod,
        shifts: _mergeOverlappingShifts(availablePeriod.shifts ?? []),
    }))
}

/**
 * Check the validity of a configuration for the time-slots service.
 * @param {Shift[]} shifts The shifts to refactor into non-overlapping shifts.
 * @returns {Shift[]}
 */
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
            /* Come back 1 element to recheck the same shift against the new next one */
            i -= 1
        }
    }

    return sortedShifts
}

/**
 * Check the validity of a configuration for the time-slots service.
 * @param {Period} period The shifts to refactor into non-overlapping shifts.
 * @returns {boolean}
 */
export function _isUnavailablePeriodValid(period: Period): boolean {
    return Boolean(
        period
        && period.startAt
        && period.endAt
        /* Both have year, or both have not */
        && (period.startAt.year == null) === (period.endAt.year == null)
        && _isPeriodMomentValid(period.startAt)
        && _isPeriodMomentValid(period.endAt)
        /**
         * If the year value isn't specified, endAt can precede startAt, and
         * doing so will set the endAt year value to the following year if needed.
         */
        && (
            period.startAt.year == null
            /* Using the objectSupport DayJS plugin, types are not up to date */
            || dayjs(period.startAt as never).isBefore(dayjs(period.endAt as never))
        ),
    )
}

/**
 * Indicate if a worked period is valid or not. Throws if not valid.
 * @param {AvailablePeriod} availablePeriod The period to check.
 * @param {number} index The index of the worked period in the list.
 * @returns {boolean}
 */
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

/**
 * Indicate either if the provided date string is valid or not.
 * @param {PeriodMoment} periodMoment The date object to check.
 * @returns {boolean}
 */
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

    /* The day check depends on month and year */
    let day = dayjs().month(periodMoment.month)
    if (periodMoment.year) {
        day = day.year(periodMoment.year)
    }

    return (
        periodMoment.day >= 1 && periodMoment.day <= day.daysInMonth()
        && (periodMoment.hour == null || (periodMoment.hour >= 0 && periodMoment.hour <= 23))
        && (periodMoment.minute == null || (periodMoment.minute >= 0 && periodMoment.minute <= 59))
    )
}

/**
 * Indicate either if the provided date string is valid or not.
 * @param {Shift} shift The date string to check.
 * @returns {boolean}
 */
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
