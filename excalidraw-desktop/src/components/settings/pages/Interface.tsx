import { DEFAULT_ZOOM, clampZoom } from "../../../vault/zoom";
import {
  MAX_NOTICE_SECONDS,
  MAX_ZOOM,
  MIN_NOTICE_SECONDS,
  MIN_ZOOM,
} from "../../../vault/preferences";
import {
  SORT_LABELS,
  SORT_ORDERS,
  type SortOrder,
} from "../../../vault/sortOrder";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Stepper, Switch } from "./controls";
import { ActivityBarEntriesSetting } from "./ActivityBarEntries";
import { ScopedRow } from "./scopedRow";

const isMac = () =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

const ZoomSetting = () => {
  const { zoom, setZoom } = useSettings();
  const mod = isMac() ? "Cmd" : "Ctrl";
  return (
    <SettingRow
      id="interface-zoom"
      description={`Scales the whole window. ${mod}+Shift +, - and 0 also work.`}
      onReset={zoom !== DEFAULT_ZOOM ? () => setZoom(DEFAULT_ZOOM) : undefined}
    >
      <div className="vault-setting-inline">
        <input
          type="range"
          className="vault-range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step="5"
          value={zoom}
          aria-label="Interface zoom"
          onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
        />
        <span className="vault-setting-readout" aria-live="polite">
          {zoom} %
        </span>
      </div>
    </SettingRow>
  );
};

const ShowTagChipsSetting = () => {
  const { showTagChips, setShowTagChips } = useSettings();
  return (
    <SettingRow id="show-tag-chips" htmlFor="vault-show-tag-chips">
      <Switch
        id="vault-show-tag-chips"
        checked={showTagChips}
        onChange={setShowTagChips}
      />
    </SettingRow>
  );
};

const NoticeSecondsSetting = () => {
  const { noticeSeconds, setNoticeSeconds } = useSettings();
  return (
    <SettingRow id="notice-seconds">
      <Stepper
        label="Error notice time"
        unit="s"
        min={MIN_NOTICE_SECONDS}
        max={MAX_NOTICE_SECONDS}
        step={1}
        value={noticeSeconds}
        onChange={setNoticeSeconds}
      />
    </SettingRow>
  );
};

const ThumbnailsSetting = () => {
  const { thumbnails, setThumbnails } = useSettings();
  return (
    <SettingRow id="thumbnails" htmlFor="vault-thumbnails">
      <Switch
        id="vault-thumbnails"
        checked={thumbnails}
        onChange={setThumbnails}
      />
    </SettingRow>
  );
};

const ActivityBarSetting = () => (
  <ScopedRow id="activity-bar" field="activityBar">
    {(value, onChange) => (
      <Switch
        id="vault-activity-bar"
        checked={value}
        label="Activity bar"
        onChange={onChange}
      />
    )}
  </ScopedRow>
);

const SortOrderSetting = () => (
  <ScopedRow id="sort-order" field="navigatorSort">
    {(value, onChange) => (
      <select
        className="vault-input"
        aria-label="Navigator sort order"
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
      >
        {SORT_ORDERS.map((order) => (
          <option key={order} value={order}>
            {SORT_LABELS[order]}
          </option>
        ))}
      </select>
    )}
  </ScopedRow>
);

export const interfaceControls: SettingControls = {
  "interface-zoom": { Component: ZoomSetting },
  "show-tag-chips": { Component: ShowTagChipsSetting },
  "notice-seconds": { Component: NoticeSecondsSetting },
  thumbnails: { Component: ThumbnailsSetting },
  "activity-bar": { Component: ActivityBarSetting },
  "activity-bar-entries": { Component: ActivityBarEntriesSetting },
  "sort-order": { Component: SortOrderSetting },
};
