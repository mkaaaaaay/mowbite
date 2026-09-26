'use client';

import MapView from '@/components/MapView';
import {BatteryIcon, HomeIcon, MapPinIcon, PlayIcon, SkipIcon, StopIcon, WarningIcon} from '@/components/icons';
import {useComputedSpeed} from '@/hooks/useComputedSpeed';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap} from '@/hooks/useMowerMap';
import {useMowerSensors} from '@/hooks/useMowerSensors';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useMowerState} from '@/hooks/useMowerState';
import {useMowerTrack} from '@/hooks/useMowerTrack';
import {batteryColor, stateColor} from '@/lib/status';
import styles from './page.module.css';

// only show the mini map while the mower is driving
const MOVING_STATES = new Set(['MOWING', 'DOCKING', 'UNDOCKING']);

const ACTION_START = 'mower_logic:idle/start_mowing';
const ACTION_STOP = 'mower_logic:mowing/pause';
const ACTION_HOME = 'mower_logic:mowing/abort_mowing';
const ACTION_SKIP_AREA = 'mower_logic:mowing/skip_area';
const ACTION_RESET_EMERGENCY = 'mower_logic/reset_emergency';

const ACTIONS = [
  {id: ACTION_START, Icon: PlayIcon, label: 'Start', color: 'accent'},
  {id: ACTION_STOP, Icon: StopIcon, label: 'Stop', color: 'warning'},
  {id: ACTION_HOME, Icon: HomeIcon, label: 'Go home', color: 'accent'},
  {id: ACTION_SKIP_AREA, Icon: SkipIcon, label: 'Skip zone', color: 'accent'},
] as const;

// 999 = no fix (xbot_positioning), same as on the sensors page
const NO_GPS_FIX_VALUE = 999;
const GPS_DISABLED_BY_DESIGN_STATES = new Set(['IDLE', 'DOCKING']);

export default function Home() {
  const {state, connected} = useMowerState();
  const {hasAction, publishAction} = useMowerActions();
  const {values: sensorValues} = useMowerSensors();
  const position = useMowerPosition() ?? state?.pose;
  const speed = useComputedSpeed(position);
  const track = useMowerTrack();
  const map = useMowerMap();
  const showMiniMap = !!map && MOVING_STATES.has(state?.current_state ?? '');
  const docked = !!state?.is_charging;
  const chargeCurrent = sensorValues['om_charge_current'];
  const chargeState = sensorValues['om_charge_state'];

  const battery = state ? Math.round(state.battery_percentage * 100) : 0;
  const status = stateColor(state?.current_state);
  const emergency = !!state?.emergency;
  const pose = state?.pose;
  const noGpsFix = pose !== undefined && pose.pos_accuracy >= NO_GPS_FIX_VALUE;
  const gpsOffByDesign = noGpsFix && GPS_DISABLED_BY_DESIGN_STATES.has(state?.current_state ?? '');
  const inDockingStation = gpsOffByDesign && !!state?.is_charging;
  const gpsAccuracyLabel = !pose
    ? '–'
    : noGpsFix
      ? gpsOffByDesign
        ? inDockingStation
          ? 'Docked'
          : 'GPS off'
        : 'No fix'
      : `${(pose.pos_accuracy * 100).toFixed(1)} cm`;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Dashboard</h1>
          <p className={styles.subtitle}>Monitor and control your robotic lawnmower with precision</p>
          <div className={styles.headerStats}>
            <div className={[styles.headerStat, styles[`headerStat-${batteryColor(battery)}`]].join(' ')}>
              <strong>{connected ? battery + '%' : '–'}</strong>
              <span className={styles.dim}>Battery</span>
            </div>
            {docked ? (
              <>
                <div className={[styles.headerStat, styles['headerStat-accent']].join(' ')}>
                  <strong>{chargeCurrent !== undefined ? `${Number(chargeCurrent).toFixed(1)} A` : '–'}</strong>
                  <span className={styles.dim}>Charging</span>
                </div>
                <div className={[styles.headerStat, styles['headerStat-accent']].join(' ')}>
                  <strong>{chargeState ?? '–'}</strong>
                  <span className={styles.dim}>Charge State</span>
                </div>
              </>
            ) : (
              <>
                <div className={[styles.headerStat, styles['headerStat-success']].join(' ')}>
                  <strong>{connected ? speed.toFixed(2) + ' m/s' : '–'}</strong>
                  <span className={styles.dim}>Speed</span>
                </div>
                <div className={[styles.headerStat, styles['headerStat-accent']].join(' ')}>
                  <strong>{connected && state ? Math.round(state.gps_percentage * 100) + '%' : '–'}</strong>
                  <span className={styles.dim}>GPS</span>
                </div>
                <div className={[styles.headerStat, styles['headerStat-accent']].join(' ')}>
                  <strong>{connected ? gpsAccuracyLabel : '–'}</strong>
                  <span className={styles.dim}>GPS Accuracy</span>
                </div>
              </>
            )}
          </div>
        </header>

        <div className={styles.layout}>
          {showMiniMap && map && (
            <div className={styles.miniMapCard}>
              <MapView map={map} mower={position} track={track} follow zoomable />
            </div>
          )}

          {state && (
            <div className={styles.mowerCard}>
              <div className={styles.mowerHeader}>
                <div>
                  <h2>Mower</h2>
                  <span className={[styles.chip, styles[`chip-${status}`]].join(' ')}>{state.current_state}</span>
                </div>
                <div className={[styles.avatar, styles[`avatar-${status}`]].join(' ')}>
                  <MapPinIcon size={22} />
                </div>
              </div>

              <div className={styles.batterySection}>
                <div className={styles.batteryHeaderRow}>
                  <span className={styles.batteryLabel}>
                    <span className={styles[`text-${batteryColor(battery)}`]}>
                      <BatteryIcon size={18} />
                    </span>
                    Battery Status
                  </span>
                  <strong className={styles[`text-${batteryColor(battery)}`]}>{battery}%</strong>
                </div>
                <div className={styles.batteryTrack}>
                  <div
                    className={[styles.batteryFill, styles[`fill-${batteryColor(battery)}`]].join(' ')}
                    style={{width: `${battery}%`}}
                  />
                </div>
              </div>

              <div className={styles.controlsSection}>
                <h3 className={styles.sectionTitle}>Controls</h3>
                <div className={styles.controlsGrid}>
                  {ACTIONS.map((a) => (
                    <button
                      key={a.id}
                      className={[styles.actionTile, styles[`tile-${a.color}`]].join(' ')}
                      disabled={!hasAction(a.id)}
                      onClick={() => publishAction(a.id)}
                    >
                      <a.Icon size={26} />
                      <span>{a.label}</span>
                    </button>
                  ))}
                  <button
                    className={[styles.actionTile, styles['tile-error'], emergency ? styles.blinking : ''].join(' ')}
                    disabled={!emergency}
                    onClick={() => publishAction(ACTION_RESET_EMERGENCY)}
                  >
                    <WarningIcon size={26} />
                    <span>Emergency</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {!state && <p className={styles.dim}>{connected ? 'waiting for status...' : 'connecting...'}</p>}
      </main>
    </div>
  );
}
