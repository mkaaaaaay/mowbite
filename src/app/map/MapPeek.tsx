'use client';

import {TitleMark} from '@/components/Logo';
import mapView from '@/components/MapView.module.css';
import {TitleRow} from '@/components/TopWeather';
import {tr, useLang} from '@/lib/i18n';
import styles from './page.module.css';

// The map page while a swipe brings it in: its title and the map's frame. The editor itself is kept by the layout
// (components/MapKeeper) and shows as soon as the swipe is done, a second one drawn here would only hold the swipe up
export default function MapPeek() {
  useLang();
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow className={styles.titleRow}>
          <h1>
            <TitleMark />
            {tr('Map')}
          </h1>
        </TitleRow>
        <div className={styles.editor}>
          <div className={styles.mapCol}>
            <div className={mapView.wrap}>
              <div className={mapView.frame}>
                <div className={mapView.svg} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
