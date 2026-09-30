# input: "<unix time> <topic> <value>" from mosquitto_sub. output, appended to OUT:
#   charge <start> <end> <minutes> <volts at start> <volts at the end>   from charging on until the charger says Done
#   run <start> <end> <blade minutes> <volts after charging> <volts when charging starts again>   between two charges
# an older battery takes a shorter charge and loses more volts per hour of mowing. a cycle cut short by a restart
# of the container is left out
BEGIN { OUT = ENVIRON["OUT"] }

{
  t = $1 + 0
  id = $2
  sub(/.*sensors\//, "", id)
  sub(/\/data$/, "", id)
  val = substr($0, index($0, $3))

  if (id == "om_v_battery") volts = val + 0
  else if (id == "om_mow_motor_rpm") {
    # blade time between two readings, gaps of the stream don't count
    if (blade && t - rpm_t < 15) blade_s += t - rpm_t
    blade = val + 0 > 500
    rpm_t = t
  } else if (id == "om_charge_current" && val + 0 > 0.1 && !charging && volts) {
    if (run_t) printf "run %d %d %.1f %.2f %.2f\n", run_t, t, blade_s / 60, run_v, volts >> OUT
    close(OUT)
    run_t = 0
    charging = 1; charge_t = t; charge_v = volts
  } else if (id == "om_charge_state" && val == "Done" && charging) {
    printf "charge %d %d %.1f %.2f %.2f\n", charge_t, t, (t - charge_t) / 60, charge_v, volts >> OUT
    close(OUT)
    charging = 0
    run_t = t; run_v = volts; blade_s = 0
  }
}
