/**
 * Stories: each is one phone-sized page. Screen threads add their screens
 * here (a container-free view with sample props), then run `npm run shots`.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  AppText,
  Button,
  Card,
  Chip,
  CollectionCard,
  EmptyState,
  HighlightedText,
  IconButton,
  ListRow,
  LockOnCorners,
  PinMark,
  ProgressCard,
  ProgressRing,
  Screen,
  ScreenHeader,
  SearchField,
  SectionHeader,
  Segmented,
  TabBar,
  Tag,
  Thumbnail,
} from '../../../src/components/ui';
import { useStrings } from '../../../src/i18n';
import { Colors, GUTTER, Space } from '../../../src/theme';
import { SettingsView } from '../../../src/screens/SettingsView';
import { WelcomeStep } from '../../../src/screens/firstRun/WelcomeStep';
import { PhotosStep } from '../../../src/screens/firstRun/PhotosStep';
import { FilesStep } from '../../../src/screens/firstRun/FilesStep';
import { ReadyView, ReadyViewProps } from '../../../src/screens/firstRun/ReadyView';
import { PhotoAccessBannerView } from '../../../src/components/PhotoAccessBannerView';
import { ModelSheetView } from '../../../src/components/ModelSheetView';
import type { DocumentAccessApi, PhotoAccessApi } from '../../../src/hooks/useStorageAccess';
import type { PhotoAccess } from '../../../src/utils/StoragePermissions';
import { GalleryScreen } from '../../../src/screens/gallery';
import { DocumentVaultScreen } from '../../../src/screens/DocumentVaultScreen';
import { PdfFoldersScreen } from '../../../src/screens/PdfFoldersScreen';
import { SmartClipboardScreen } from '../../../src/screens/SmartClipboardScreen';
import { setPreviewRouteParams } from './shims/Navigation';
import { fakePhoto } from './shims/sample';
import type { DocumentRecord } from '../../../src/database/types';
import { ResultItem } from '../../../src/screens/pinpointer/ResultItem';
import { RecentSearches } from '../../../src/screens/pinpointer/RecentSearches';
import { ListeningPanel } from '../../../src/screens/pinpointer/ListeningPanel';
import { NothingFound } from '../../../src/screens/pinpointer/NothingFound';
import { alsoSearchedAs } from '../../../src/utils/MatchTerms';

const TABS = (t: ReturnType<typeof useStrings>['t']) => [
  { key: 'home', label: t('tab.home'), icon: 'home' as const },
  { key: 'photos', label: t('tab.photos'), icon: 'photos' as const },
  { key: 'papers', label: t('tab.papers'), icon: 'papers' as const },
  { key: 'settings', label: t('tab.settings'), icon: 'settings' as const },
];

/** A tab screen with the real tab bar under it. */
const WithTabs: React.FC<{ active: string; children: React.ReactNode }> = ({ active, children }) => {
  const { t } = useStrings();
  const [key, setKey] = useState(active);
  return (
    <View style={styles.fill}>
      <View style={styles.fill}>{children}</View>
      <TabBar items={TABS(t)} activeKey={key} onSelect={setKey} scanLabel={t('tab.scan')} onScan={() => {}} bottomInset={16} />
    </View>
  );
};

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => <View style={styles.row}>{children}</View>;

/** Every kit part on one long page. */
const Kit: React.FC = () => {
  const { t, ago } = useStrings();
  const [chip, setChip] = useState('all');
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [query, setQuery] = useState('bijli bill');
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.page}>
        <ScreenHeader title="UI kit" subtitle="Pinpointer design system" actions={<PinMark size={36} />} />
        <View style={styles.gutter}>
          <SearchField placeholder={t('search.placeholder')} value={query} onChangeText={setQuery} onVoicePress={() => {}} active />
        </View>
        <View style={styles.gutter}>
          <SearchField placeholder={t('search.placeholder')} onPressFake={() => {}} onVoicePress={() => {}} />
        </View>
        <SectionHeader title={t('home.findQuickly')} actionLabel={t('common.seeAll')} onAction={() => {}} />
        <View style={[styles.gutter, styles.grid]}>
          <CollectionCard label={t('collection.id')} icon="idCard" tint="id" countLabel={t('collection.count', { n: 4 })} onPress={() => {}} />
          <CollectionCard label={t('collection.bills')} icon="bill" tint="bill" countLabel={t('collection.count', { n: 23 })} onPress={() => {}} />
          <CollectionCard label={t('collection.medicine')} icon="medicine" tint="medicine" countLabel={t('collection.count', { n: 9 })} onPress={() => {}} />
        </View>
        <View style={[styles.gutter, styles.grid]}>
          <CollectionCard label={t('collection.bank')} icon="bank" tint="bank" countLabel={t('collection.count', { n: 6 })} onPress={() => {}} />
          <CollectionCard label={t('collection.screenshots')} icon="screenshot" tint="screenshot" countLabel={t('collection.count', { n: 1240 })} onPress={() => {}} />
          <CollectionCard label={t('collection.family')} icon="family" tint="family" countLabel={t('collection.count', { n: 312 })} onPress={() => {}} />
        </View>

        <SectionHeader title="Progress" />
        <View style={[styles.gutter, styles.stack]}>
          <ProgressCard
            title={t('progress.photosTitle')}
            detail={t('progress.count', { done: 1240, total: 3400 })}
            value={1240 / 3400}
            state="running"
            actionLabel={t('progress.pause')}
            onAction={() => {}}
            note={t('progress.keepsGoing')}
          />
          <ProgressCard
            title={t('progress.allPhotosReady', { total: 3400 })}
            detail={t('progress.checked', { when: ago(Date.now() - 2 * 60 * 1000) })}
            state="done"
            actionLabel={t('progress.checkAgain')}
            onAction={() => {}}
          />
          <View style={styles.center}>
            <ProgressRing value={0.62}>
              <AppText variant="numeral">62%</AppText>
            </ProgressRing>
          </View>
        </View>

        <SectionHeader title="Buttons" />
        <View style={[styles.gutter, styles.stack]}>
          <Button label={t('onboarding.startSearching')} variant="beam" icon="search" block />
          <Button label={t('onboarding.allowPhotos')} icon="photos" block />
          <Row>
            <Button label={t('progress.checkAgain')} variant="secondary" size="compact" icon="refresh" />
            <Button label={t('common.notNow')} variant="ghost" size="compact" />
            <Button label={t('common.remove')} variant="danger" size="compact" icon="trash" />
          </Row>
          <Row>
            <IconButton icon="mic" label="mic" variant="beam" />
            <IconButton icon="star" label="star" variant="tonal" filled fillColor={Colors.importantStar} iconColor={Colors.important} />
            <IconButton icon="share" label="share" variant="tonal" />
            <IconButton icon="more" label="more" variant="plain" />
            <IconButton icon="close" label="close" variant="primary" />
          </Row>
        </View>

        <SectionHeader title="Chips and tags" />
        <View style={[styles.gutter, styles.stack]}>
          <Row>
            {(['all', 'photos', 'papers'] as const).map(k => (
              <Chip
                key={k}
                label={t(k === 'all' ? 'search.filterAll' : k === 'photos' ? 'search.filterPhotos' : 'search.filterPapers')}
                selected={chip === k}
                onPress={() => setChip(k)}
              />
            ))}
          </Row>
          <Row>
            <Chip label="aadhaar" icon="clock" removable />
            <Tag label={t('search.textMatch')} tone="found" icon="check" />
            <Tag label={t('common.important')} tone="important" icon="star" />
          </Row>
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: t('lang.en') },
              { value: 'hi', label: t('lang.hi') },
            ]}
          />
        </View>

        <SectionHeader title="Results" />
        <Card flush style={styles.gutter}>
          <ListRow
            title="Electricity bill, March"
            subtitle="Bill · 2 pages"
            leading={<Thumbnail size={56} fallbackIcon="papers" />}
            onPress={() => {}}
          />
          <ListRow title={t('settings.language')} subtitle="English" icon="language" onPress={() => {}} />
          <ListRow title={t('settings.privacy')} subtitle={t('settings.privacyBody')} icon="shield" iconTint={{ bg: Colors.foundSoft, ink: Colors.found }} last />
        </Card>
        <Card style={[styles.gutter, styles.topGap]}>
          <AppText variant="label" color="textMuted">{t('viewer.textInPhoto')}</AppText>
          <HighlightedText
            variant="body"
            text="BSES Rajdhani Power Ltd. Electricity bill for March. Amount payable ₹1,240. बिजली बिल"
            terms={['bill', 'बिजली']}
          />
        </Card>
        <View style={[styles.gutter, styles.lockDemo]}>
          <View style={styles.lockTarget}>
            <LockOnCorners />
            <AppText variant="bodyStrong">आधार / Aadhaar</AppText>
          </View>
        </View>

        <EmptyState
          icon="search"
          title={t('search.nothingTitle', { q: 'ration card' })}
          body={t('search.nothingBody')}
          actionLabel={t('search.lookEverywhere')}
          onAction={() => {}}
        />
      </ScrollView>
    </Screen>
  );
};

const noop = () => {};

/** Stand-ins for the access hooks: the steps only read `access` and call these. */
const fakePhotos = (access: PhotoAccess | null, answer: PhotoAccess = 'denied'): PhotoAccessApi => ({
  access,
  refresh: async () => access ?? 'denied',
  request: async () => answer,
  openSettings: async () => answer,
});
const fakeDocs = (canAskAll = true): DocumentAccessApi => ({
  access: 'none',
  canAskAll,
  refresh: async () => 'none',
  allowAll: async () => 'none',
  chooseFolder: async () => false,
  pickFiles: async () => 0,
});

/** First-run steps fill the phone, like FirstRunScreen. */
const Step: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Screen padBottom>{children}</Screen>
);

const READY: Omit<ReadyViewProps, 'dots'> = {
  photos: { allowed: true, done: 120, total: 2400, busy: true, finished: false },
  papers: { allowed: true, done: 0, total: null, running: false, waiting: true },
  onAllowPhotos: noop,
  onAllowPapers: noop,
  onFinish: noop,
};
const READY_DOTS = { index: 3, count: 4, from: 3 };

const welcome = () => (
  <Step>
    <WelcomeStep dots={{ index: 0, count: 4, from: 0 }} onNext={noop} />
  </Step>
);
const photos = () => (
  <Step>
    <PhotosStep dots={{ index: 1, count: 4, from: 1 }} photos={fakePhotos(null)} onNext={noop} onBack={noop} />
  </Step>
);
const files = () => (
  <Step>
    <FilesStep dots={{ index: 2, count: 4, from: 2 }} docs={fakeDocs()} onNext={noop} onBack={noop} />
  </Step>
);
const ready = () => (
  <Step>
    <ReadyView dots={READY_DOTS} {...READY} />
  </Step>
);
const settings = () => (
  <WithTabs active="settings">
    <SettingsView
      photoAccess="limited"
      docAccess="all"
      voice="ready"
      onChangePhotos={noop}
      onChangePapers={noop}
      onOpenHelpers={noop}
    />
  </WithTabs>
);
const models = () => (
  <WithTabs active="settings">
    <SettingsView
      photoAccess="full"
      docAccess="all"
      voice="ready"
      onChangePhotos={noop}
      onChangePapers={noop}
      onOpenHelpers={noop}
      sheet={<ModelSheetView visible voice="ready" photo="missing" onPrepare={noop} onClose={noop} />}
    />
  </WithTabs>
);

const photosBlocked = () => (
  <Step>
    <PhotosStep dots={{ index: 1, count: 4, from: 1 }} photos={fakePhotos('blocked')} onNext={noop} onBack={noop} />
  </Step>
);

const filesFolder = () => (
  <Step>
    <FilesStep dots={{ index: 2, count: 4, from: 2 }} docs={fakeDocs(false)} onNext={noop} onBack={noop} />
  </Step>
);

const readyLimited = () => (
  <Step>
    <ReadyView
      dots={READY_DOTS}
      {...READY}
      photos={{ allowed: true, done: 18, total: 40, busy: true, finished: false }}
      banner={<PhotoAccessBannerView inline onAllow={noop} onKeep={noop} />}
    />
  </Step>
);

const readyDone = () => (
  <Step>
    <ReadyView
      dots={READY_DOTS}
      {...READY}
      photos={{ allowed: true, done: 2400, total: 2400, busy: false, finished: true }}
      papers={{ allowed: true, done: 14, total: null, running: false, waiting: false }}
    />
  </Step>
);

const readyOff = () => (
  <Step>
    <ReadyView
      dots={READY_DOTS}
      {...READY}
      photos={{ allowed: false, done: 0, total: null, busy: false, finished: false }}
      papers={{ allowed: false, done: 0, total: null, running: false, waiting: false }}
    />
  </Step>
);

const tabBanner = () => (
  <WithTabs active="photos">
    <Screen>
      <ScreenHeader title="Photos" />
      <View style={styles.fill} />
      <PhotoAccessBannerView style={styles.tabBanner} onAllow={noop} onKeep={noop} />
    </Screen>
  </WithTabs>
);

/** The Scan screen, opened on a photo so it shows what it read. */
const Scan: React.FC<{ photo?: string }> = ({ photo }) => {
  setPreviewRouteParams(photo ? { scanUri: photo } : undefined);
  return <SmartClipboardScreen />;
};


// ─── Search ─────────────────────────────────────────────────────────────────
// The search screen's layout (SearchOverlay itself opens files, which needs
// native modules): back, the field, then results, history, listening or
// nothing found.

const SEARCH_NOW = Date.now();
const SEARCH_RESULTS: DocumentRecord[] = [
  {
    id: 1,
    type: 'DOCUMENT',
    title: 'Electricity bill October',
    content: 'BSES Rajdhani. Electricity bill for October. Amount due 1,240. Pay by 5 November.',
    filePath: 'file:///Download/bses_oct.pdf',
    detection_type: 'TEXT',
    timestamp: SEARCH_NOW - 3 * 86400000,
  },
  {
    id: 2,
    type: 'IMAGE',
    content: 'बिजली बिल भुगतान रसीद राशि 1240 रुपये',
    filePath: 'file:///photos/receipt.jpg',
    detection_type: 'TEXT',
    timestamp: SEARCH_NOW - 86400000,
  },
  {
    id: 3,
    type: 'IMAGE',
    content: 'Paid at the counter. Bill no 44812, electricity board.',
    filePath: 'file:///photos/counter.jpg',
    detection_type: 'TEXT',
    timestamp: SEARCH_NOW - 7 * 86400000,
  },
  {
    id: 4,
    type: 'IMAGE',
    content: 'Paper, Document, Text',
    filePath: 'file:///photos/paper.jpg',
    detection_type: 'OBJECT',
    timestamp: SEARCH_NOW - 9 * 86400000,
  },
];

const SearchFrame: React.FC<{ query?: string; listening?: boolean; children: React.ReactNode }> = ({
  query = '',
  listening = false,
  children,
}) => {
  const { t } = useStrings();
  return (
    <Screen padBottom={false}>
      <View style={styles.searchHead}>
        <IconButton icon="back" label={t('search.close')} onPress={noop} />
        <View style={styles.fill}>
          <SearchField
            value={query}
            onChangeText={noop}
            placeholder={t('search.placeholder')}
            onVoicePress={noop}
            listening={listening}
            active={listening || undefined}
          />
        </View>
      </View>
      {children}
    </Screen>
  );
};

const searchResults = () => <SearchResultsStory />;
const SearchResultsStory = () => {
  const { t } = useStrings();
  const [filter, setFilter] = useState<'ALL' | 'IMAGE' | 'DOCUMENT'>('ALL');
  const q = 'bijli bill';
  const photos = SEARCH_RESULTS.filter(r => r.type === 'IMAGE').length;
  const counts = { ALL: SEARCH_RESULTS.length, IMAGE: photos, DOCUMENT: SEARCH_RESULTS.length - photos };
  const shown = filter === 'ALL' ? SEARCH_RESULTS : SEARCH_RESULTS.filter(r => r.type === filter);
  const filters = [
    { id: 'ALL' as const, label: t('search.filterAll') },
    { id: 'IMAGE' as const, label: t('search.filterPhotos') },
    { id: 'DOCUMENT' as const, label: t('search.filterPapers') },
  ];
  return (
    <SearchFrame query={q}>
      <View style={[styles.row, styles.searchFilters]}>
        {filters.map(f => (
          <Chip
            key={f.id}
            label={t('search.filterCount', { label: f.label, n: counts[f.id] })}
            selected={filter === f.id}
            onPress={() => setFilter(f.id)}
          />
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.searchList}>
        <View style={styles.stack}>
          <AppText variant="label" color="textSecondary">
            {t('search.found', { n: shown.length })}
          </AppText>
          <View style={styles.row}>
            <AppText variant="small" color="textMuted">
              {t('search.alsoSearched')}
            </AppText>
            {alsoSearchedAs(q).map(w => (
              <Tag key={w} label={w} tone="neutral" />
            ))}
          </View>
          {shown.map((item, i) => (
            <ResultItem key={item.id} item={item} query={q} index={i} pinned={i === 1} onPress={noop} />
          ))}
        </View>
      </ScrollView>
    </SearchFrame>
  );
};

const searchHistory = () => (
  <SearchFrame>
    <RecentSearches
      now={SEARCH_NOW}
      history={[
        { query: 'bijli bill', timestamp: SEARCH_NOW - 3600000, resultCount: 4 },
        { query: 'आधार', timestamp: SEARCH_NOW - 7200000, resultCount: 2 },
        { query: 'my aadhaar 4821 5512 9930', timestamp: SEARCH_NOW - 30 * 3600000, resultCount: 1 },
        { query: 'passport photo', timestamp: SEARCH_NOW - 50 * 3600000, resultCount: 0 },
      ]}
      onSelect={noop}
      onDelete={noop}
      onClearAll={noop}
    />
  </SearchFrame>
);

const searchListening = () => (
  <SearchFrame listening>
    <ListeningPanel listening understanding={false} onStop={noop} />
  </SearchFrame>
);

const searchUnderstanding = () => (
  <SearchFrame>
    <ListeningPanel listening={false} understanding onStop={noop} />
  </SearchFrame>
);

const searchNothing = () => (
  <SearchFrame query="pasport">
    <NothingFound
      query="pasport"
      onLookEverywhere={noop}
      history={[
        { query: 'passport', timestamp: SEARCH_NOW, resultCount: 2 },
        { query: 'bijli bill', timestamp: SEARCH_NOW, resultCount: 4 },
      ]}
      onSelect={noop}
    />
  </SearchFrame>
);

const searchNothingIndexing = () => (
  <SearchFrame query="ration card">
    <NothingFound query="ration card" indexing={{ done: 420, total: 2400 }} onLookEverywhere={noop} history={[]} onSelect={noop} />
  </SearchFrame>
);

export const STORIES: Record<string, { title: string; lang: 'en' | 'hi'; render: () => React.ReactElement }> = {
  kit: { title: 'UI kit (English)', lang: 'en', render: () => <WithTabs active="home"><Kit /></WithTabs> },
  'kit-hi': { title: 'UI kit (Hindi)', lang: 'hi', render: () => <WithTabs active="home"><Kit /></WithTabs> },
  settings: { title: 'Settings', lang: 'en', render: settings },
  'settings-hi': { title: 'Settings (Hindi)', lang: 'hi', render: settings },
  models: { title: 'Voice and photo search sheet', lang: 'en', render: models },
  'models-hi': { title: 'Voice and photo search sheet (Hindi)', lang: 'hi', render: models },
  welcome: { title: 'First run: welcome', lang: 'en', render: welcome },
  'welcome-hi': { title: 'First run: welcome (Hindi)', lang: 'hi', render: welcome },
  photos: { title: 'First run: photos', lang: 'en', render: photos },
  'photos-hi': { title: 'First run: photos (Hindi)', lang: 'hi', render: photos },
  'photos-blocked': { title: 'First run: photos, Android won’t ask again', lang: 'en', render: photosBlocked },
  files: { title: 'First run: PDFs', lang: 'en', render: files },
  'files-hi': { title: 'First run: PDFs (Hindi)', lang: 'hi', render: files },
  'files-folder': { title: 'First run: PDFs, folder only', lang: 'en', render: filesFolder },
  ready: { title: 'First run: getting photos ready', lang: 'en', render: ready },
  'ready-hi': { title: 'First run: getting photos ready (Hindi)', lang: 'hi', render: ready },
  'ready-limited': { title: 'First run: only some photos allowed', lang: 'en', render: readyLimited },
  'ready-done': { title: 'First run: every photo ready', lang: 'en', render: readyDone },
  'ready-off': { title: 'First run: nothing allowed yet', lang: 'en', render: readyOff },
  'tab-banner': { title: 'Only some photos: banner above the tabs', lang: 'en', render: tabBanner },
  gallery: { title: 'Photos', lang: 'en', render: () => <WithTabs active="photos"><GalleryScreen /></WithTabs> },
  'gallery-hi': { title: 'Photos (Hindi)', lang: 'hi', render: () => <WithTabs active="photos"><GalleryScreen /></WithTabs> },
  papers: { title: 'Papers', lang: 'en', render: () => <WithTabs active="papers"><DocumentVaultScreen /></WithTabs> },
  'papers-hi': { title: 'Papers (Hindi)', lang: 'hi', render: () => <WithTabs active="papers"><DocumentVaultScreen /></WithTabs> },
  folders: { title: 'Where Pinpointer looks', lang: 'en', render: () => <PdfFoldersScreen /> },
  'folders-hi': { title: 'Where Pinpointer looks (Hindi)', lang: 'hi', render: () => <PdfFoldersScreen /> },
  scan: { title: 'Scan', lang: 'en', render: () => <Scan /> },
  'scan-text': { title: 'Scan: text found', lang: 'en', render: () => <Scan photo={fakePhoto(0)} /> },
  'scan-text-hi': { title: 'Scan: text found (Hindi)', lang: 'hi', render: () => <Scan photo={fakePhoto(0)} /> },
  'scan-empty': { title: 'Scan: no words found', lang: 'en', render: () => <Scan photo={`${fakePhoto(3)}#empty`} /> },
  'search-results': { title: 'Search: results with filters', lang: 'en', render: searchResults },
  'search-results-hi': { title: 'Search: results with filters (Hindi)', lang: 'hi', render: searchResults },
  'search-history': { title: 'Search: recent searches', lang: 'en', render: searchHistory },
  'search-history-hi': { title: 'Search: recent searches (Hindi)', lang: 'hi', render: searchHistory },
  'search-listening': { title: 'Search: listening', lang: 'en', render: searchListening },
  'search-listening-hi': { title: 'Search: listening (Hindi)', lang: 'hi', render: searchListening },
  'search-understanding': { title: 'Search: understanding', lang: 'en', render: searchUnderstanding },
  'search-nothing': { title: 'Search: nothing found', lang: 'en', render: searchNothing },
  'search-nothing-hi': { title: 'Search: nothing found (Hindi)', lang: 'hi', render: searchNothing },
  'search-nothing-indexing': { title: 'Search: nothing found while photos are read', lang: 'en', render: searchNothingIndexing },

};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { paddingBottom: Space.huge },
  gutter: { marginHorizontal: GUTTER, marginTop: Space.md },
  grid: { flexDirection: 'row', gap: Space.md },
  stack: { gap: Space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, alignItems: 'center' },
  center: { alignItems: 'center', paddingVertical: Space.md },
  topGap: { marginTop: Space.md },
  lockDemo: { alignItems: 'center', paddingVertical: Space.xxl },
  lockTarget: { paddingHorizontal: Space.md, paddingVertical: Space.xs },
  tabBanner: { marginHorizontal: GUTTER, marginBottom: Space.sm },
  searchHead: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingLeft: Space.xs, paddingRight: GUTTER, paddingVertical: Space.sm },
  searchFilters: { paddingHorizontal: GUTTER, paddingBottom: Space.sm },
  searchList: { paddingHorizontal: GUTTER, paddingBottom: Space.huge },
});
