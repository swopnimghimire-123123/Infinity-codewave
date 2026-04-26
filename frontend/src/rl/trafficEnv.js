const PHASES = ['NS_straight', 'NS_left', 'EW_straight', 'EW_left']
const MIN_GREEN_STEPS  = 10
const MAX_GREEN_STEPS  = 60
const YELLOW_STEPS     = 3      // yellow clearance steps before next green
const EPISODE_LENGTH   = 3600
const FLOW_RATE        = 2
const STATE_QUEUE_NORM = 60

class TrafficEnv {
  constructor(config = {}) {
    this.spawnRate          = config.spawnRate          ?? 0.7
    this.leftTurnMultiplier = config.leftTurnMultiplier ?? 1.0
    this.episodeLength      = config.episodeLength      ?? EPISODE_LENGTH
    this._rng               = null  // set to seeded fn during validation
    this.reset()
  }

  reset() {
    this.queues               = { NS: 0, EW: 0, NSL: 0, EWL: 0 }
    this.currentPhase         = 0
    this.timeInPhase          = 0
    this.yellowStepsLeft      = 0   // counts down yellow phase
    this.totalSteps           = 0
    this.totalWait            = 0
    this.totalSwitches        = 0
    this.totalVehiclesCleared = 0
    this.clearedPerLane       = { NS: 0, EW: 0, NSL: 0, EWL: 0 }
    return this._getState()
  }

  step(agentAction) {
    // ── Yellow phase: no clearing, just count down ──────────────────────────
    if (this.yellowStepsLeft > 0) {
      this.yellowStepsLeft--

      // Vehicles still spawn during yellow, but nothing clears (junction empties)
      this._spawnOnly()

      const totalAfter = this._totalQueue()
      this.totalSteps++
      this.totalWait += totalAfter
      const done = this.totalSteps >= this.episodeLength

      return {
        nextState: this._getState(),
        reward: 0,
        done,
        info: {
          switched: false,
          locked: true,
          yellow: true,
          forcedSwitch: false,
          queuesAfter: this._getQueueArray(),
          totalAfter,
          currentPhase: this.currentPhase,
          yellowStepsLeft: this.yellowStepsLeft,
        },
      }
    }

    // ── Normal green phase logic ────────────────────────────────────────────
    const locked       = this.timeInPhase < MIN_GREEN_STEPS
    const forcedSwitch = this.timeInPhase >= MAX_GREEN_STEPS
    let action = agentAction
    if (locked)       action = 0
    if (forcedSwitch) action = 1
    const switched = (action === 1)

    const queuesBefore = this._getQueueArray()

    if (switched) {
      // Trigger yellow before advancing to next phase
      this.yellowStepsLeft = YELLOW_STEPS
      this.currentPhase    = (this.currentPhase + 1) % 4
      this.timeInPhase     = 0
      this.totalSwitches++
    } else {
      this.timeInPhase++
    }

    // Only clear vehicles if we're NOT entering yellow this step
    const cleared = switched ? 0 : this._simTick()

    if (switched) {
      // Still spawn vehicles on switch step, just no clearing
      this._spawnOnly()
    }

    const queuesAfter    = this._getQueueArray()
    const totalBefore    = queuesBefore.reduce((a, b) => a + b, 0)
    const totalAfter     = queuesAfter.reduce((a, b) => a + b, 0)

    const queueDelta     = totalBefore - totalAfter
    const nsPressure     = this.queues.NS + this.queues.NSL
    const ewPressure     = this.queues.EW + this.queues.EWL
    const balancePenalty  = -0.01  * Math.abs(nsPressure - ewPressure)
    const pressurePenalty = -0.015 * totalAfter
    const switchPenalty   = switched ? -0.08 : 0.0
    const throughputBonus = 0.25   * cleared
    const reward = (0.5 * queueDelta) + throughputBonus + pressurePenalty + balancePenalty + switchPenalty

    this.totalSteps++
    this.totalWait += totalAfter
    const done = this.totalSteps >= this.episodeLength

    return {
      nextState: this._getState(),
      reward,
      done,
      info: {
        switched,
        locked,
        yellow: false,
        forcedSwitch,
        queuesAfter,
        totalAfter,
        currentPhase: this.currentPhase,
        yellowStepsLeft: 0,
      },
    }
  }

  getEpisodeSummary() {
    return {
      avgQueueLength:       this.totalWait / this.totalSteps,
      totalSwitches:        this.totalSwitches,
      totalVehiclesCleared: this.totalVehiclesCleared,
      clearedPerLane:       { ...this.clearedPerLane },
      stepsPerPhase:        this.totalSteps / Math.max(1, this.totalSwitches),
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _getState() {
    const clamp01 = (v) => Math.max(0, Math.min(1, v))
    return [
      clamp01(this.queues.NS  / STATE_QUEUE_NORM),
      clamp01(this.queues.EW  / STATE_QUEUE_NORM),
      clamp01(this.queues.NSL / STATE_QUEUE_NORM),
      clamp01(this.queues.EWL / STATE_QUEUE_NORM),
      this.currentPhase / Math.max(1, PHASES.length - 1),
      Math.min(this.timeInPhase / MAX_GREEN_STEPS, 1.0),
      this.yellowStepsLeft > 0 ? 1 : 0,   // yellow flag for agent/renderer
    ]
  }

  _getQueueArray() {
    return [this.queues.NS, this.queues.EW, this.queues.NSL, this.queues.EWL]
  }

  _totalQueue() {
    return this.queues.NS + this.queues.EW + this.queues.NSL + this.queues.EWL
  }

  _rand() {
    return this._rng ? this._rng() : Math.random()
  }

  /** Spawn vehicles only — no clearing (used during yellow & switch step) */
  _spawnOnly() {
    const leftRate = this.spawnRate * 0.3 * this.leftTurnMultiplier
    this.queues.NS  += this._rand() < this.spawnRate ? 1 : 0
    this.queues.EW  += this._rand() < this.spawnRate ? 1 : 0
    this.queues.NSL += this._rand() < leftRate       ? 1 : 0
    this.queues.EWL += this._rand() < leftRate       ? 1 : 0
  }

  /** Spawn vehicles AND clear the active phase queue */
  _simTick() {
    this._spawnOnly()

    const phase = PHASES[this.currentPhase]
    let cleared = 0
    if (phase === 'NS_straight') {
      const b = this.queues.NS;  this.queues.NS  = Math.max(0, this.queues.NS  - FLOW_RATE); cleared = b - this.queues.NS
      this.clearedPerLane.NS += cleared
    } else if (phase === 'NS_left') {
      const b = this.queues.NSL; this.queues.NSL = Math.max(0, this.queues.NSL - FLOW_RATE); cleared = b - this.queues.NSL
      this.clearedPerLane.NSL += cleared
    } else if (phase === 'EW_straight') {
      const b = this.queues.EW;  this.queues.EW  = Math.max(0, this.queues.EW  - FLOW_RATE); cleared = b - this.queues.EW
      this.clearedPerLane.EW += cleared
    } else if (phase === 'EW_left') {
      const b = this.queues.EWL; this.queues.EWL = Math.max(0, this.queues.EWL - FLOW_RATE); cleared = b - this.queues.EWL
      this.clearedPerLane.EWL += cleared
    }
    this.totalVehiclesCleared += cleared
    return cleared
  }
}

export {
  TrafficEnv,
  PHASES,
  MIN_GREEN_STEPS,
  MAX_GREEN_STEPS,
  YELLOW_STEPS,
  EPISODE_LENGTH,
  STATE_QUEUE_NORM,
}