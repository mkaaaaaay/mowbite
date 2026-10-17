'use client';

import {CopyCommand} from './Updates';
import {tr} from '@/lib/i18n';
import {plannerSeen} from '@/lib/mowerBody';

// mower_logic sends no state while the rest of OpenMower answers: what to look at on the mower. The planner first when
// this mower had one here, OpenMower set to it waits for it
export default function LogicHint({className}: {className?: string}) {
  return (
    <div className={className}>
      {plannerSeen() && (
        <>
          <span>
            {tr(
              "With the MowBite Planner (OM_PLANNER=external) OpenMower waits for it and starts mower_logic again every 70 s. Is the planner's container running? To start it:",
            )}
          </span>
          <CopyCommand command="docker start mowbite_planner" />
        </>
      )}
      <span>{tr("If it stays like this, OpenMower's log on the mower says why:")}</span>
      <CopyCommand command="docker logs --tail 50 open_mower_ros" />
    </div>
  );
}
