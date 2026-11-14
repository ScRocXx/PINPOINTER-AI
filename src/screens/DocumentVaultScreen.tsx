import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, NativeModules, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  PressableScale,
  ProgressCard,
  Reveal,
  Screen,
  ScreenHeader,
  SearchField,
  SectionHeader,
  Sheet,
  SheetAction,
  Tag,
  useToast,
} from '../components/ui';
import { Colors, GUTTER, Radius, Space, Touch } from '../theme';
import { formatWhen, useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { getAllDocuments, searchDocuments } from '../database';
import { type PinpointerState, usePinpointerShared } from '../hooks/PinpointerContext';
import { noteInteraction } from '../services/InteractionGate';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { describePlaces, usePdfPlaces } from '../hooks/usePdfPlaces';
import { useScreenFocus } from '../hooks/useScreenFocus';
import { forgetIfGone } from '../utils/MissingFiles';
import { AppLogger } from '../utils/AppLogger';
import {
  PAPER_GROUPS,
  PAPER_GROUP_LOOK,
  Paper,
  PaperGroup,
  countByGroup,
  matchesQuery,
  tintOf,
  toPaper,
} from '../utils/PaperGroups';

/** Papers shown before "Show more". */
export const PAPERS_PAGE = 30;
const SEARCH_DELAY_MS = 250;

const openPdf = (filePath: string): void => {
  const { StorageModule } = NativeModules;
  if (StorageModule?.openPDF) {
    StorageModule.openPDF(filePath.replace('file://', ''));
    return;
  }
  const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
  Linking.openURL(uri).catch(e => AppLogger.warn('Papers', 'Could not open the PDF', e));
};

/** Papers reads only PDF progress, so typing in search or photo progress doesn't redraw it. */
const selectPapersSync = (s: PinpointerState) => ({
  isSyncingDocs: s.isSyncingDocs,
  docSyncCount: s.docSyncCount,
  totalDocs: s.totalDocs,
  lastDocSyncTime: s.lastDocSyncTime,
  handleDocumentSync: s.handleDocumentSync,
});

/**
 * Papers: every PDF Pinpointer has read, newest first. Six big tiles (ID
 * cards, Bills, Bank, Medical, Tax, Other) narrow the list; the search
 * button finds a paper by any word in it, Hindi too. "Where Pinpointer
 * looks" opens the folders screen, and "Add a folder or PDF" adds more.
 */
export const DocumentVaultScreen: React.FC = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { t, ago } = useStrings();
  const toast = useToast();
  const focused = useScreenFocus();
  const { isPinned, toggle } = usePinnedItems();
  const places = usePdfPlaces();
  const { isSyncingDocs, docSyncCount, totalDocs, lastDocSyncTime, handleDocumentSync } =
    usePinpointerShared(selectPapersSync);

  const [papers, setPapers] = useState<Paper[]>([]);
  const [group, setGroup] = useState<PaperGroup | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(PAPERS_PAGE);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(() => {
    setPapers(getAllDocuments().map(toPaper));
  }, []);

  // Load when the tab is shown, and again when a document check starts or
  // finishes, so papers already read stay on screen during a check.
  useEffect(() => {
    if (focused) {
      load();
    }
  }, [focused, isSyncingDocs, load]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => setLimit(PAPERS_PAGE), [group, debounced]);

  const counts = useMemo(() => countByGroup(papers), [papers]);

  const shown: Paper[] = useMemo(() => {
    if (debounced) {
      // The search engine first (it understands Hindi and sound-alikes),
      // then plain matches it missed, so nothing that contains the word hides.
      const byPath = new Map(papers.map(p => [p.doc.filePath, p]));
      const found: Paper[] = [];
      const seen = new Set<string>();
      for (const r of searchDocuments(debounced)) {
        const p = r.type === 'DOCUMENT' ? byPath.get(r.filePath) : undefined;
        if (p && !seen.has(p.doc.filePath)) {
          found.push(p);
          seen.add(p.doc.filePath);
        }
      }
      for (const p of papers) {
        if (!seen.has(p.doc.filePath) && matchesQuery(p, debounced)) {
          found.push(p);
        }
      }
      return found;
    }
    return group ? papers.filter(p => p.group === group) : papers;
  }, [debounced, group, papers]);

  const open = useCallback(
    async (paper: Paper) => {
      if (await forgetIfGone(paper.doc.filePath, 'DOCUMENT')) {
        toast.show(t('error.fileGone'), { icon: 'alert' });
        load();
        return;
      }
      try {
        openPdf(paper.doc.filePath);
      } catch (e) {
        AppLogger.warn('Papers', 'Could not open the PDF', e);
        toast.show(t('papers.openFailed'), { icon: 'alert' });
      }
    },
    [load, t, toast],
  );

  const star = useCallback(
    async (paper: Paper) => {
      const now = await toggle({ uri: paper.doc.filePath, kind: 'DOCUMENT', title: paper.title });
      toast.show(t(now ? 'viewer.markedImportant' : 'viewer.removedImportant'), { icon: 'star' });
    },
    [t, toast, toggle],
  );

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setDebounced('');
  };

  const total = papers.length;

  // Without All files access, check the chosen folders and picked PDFs
  // quietly; with nothing to read yet, show where Pinpointer can look
  // instead of a pop-up.
  const findPapers = () => {
    if (!places.ready || places.standard) {
      handleDocumentSync();
    } else if (places.folders.length > 0 || total > 0) {
      handleDocumentSync(undefined, true);
    } else {
      navigation.navigate('PdfFolders');
    }
  };

  const startAdd = () => {
    if (places.canPick) {
      setAddOpen(true);
    } else {
      navigation.navigate('PdfFolders');
    }
  };

  const listTitle = group ? t(PAPER_GROUP_LOOK[group].label) : t('papers.recent');

  const progress = isSyncingDocs ? (
    <ProgressCard
      title={t('progress.papersTitle')}
      detail={totalDocs > 0 ? t('progress.countShort', { done: docSyncCount, total: totalDocs }) : undefined}
      value={totalDocs > 0 ? docSyncCount / totalDocs : undefined}
      state="running"
      icon="papers"
      style={styles.gutter}
      testID="papers-progress"
    />
  ) : total > 0 ? (
    <ProgressCard
      title={t('progress.allPapersReady', { total })}
      detail={t('progress.checked', { when: ago(lastDocSyncTime) })}
      state="done"
      icon="papers"
      actionLabel={t('progress.checkAgain')}
      onAction={findPapers}
      style={styles.gutter}
      testID="papers-ready"
    />
  ) : null;

  return (
    <Screen testID="papers-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={noteInteraction}
        scrollEventThrottle={100}
        testID="papers-scroll"
      >
        <ScreenHeader
          title={t('papers.title')}
          subtitle={total > 0 ? t('papers.count', { n: total }) : undefined}
          actions={
            total > 0 ? (
              <IconButton
                icon={searchOpen ? 'close' : 'search'}
                label={t(searchOpen ? 'papers.closeSearch' : 'papers.search')}
                variant="tonal"
                onPress={searchOpen ? closeSearch : () => setSearchOpen(true)}
                testID="papers-search-toggle"
              />
            ) : undefined
          }
        />

        {searchOpen ? (
          <View style={styles.gutter}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder={t('papers.searchPlaceholder')}
              autoFocus
              returnKeyType="search"
              testID="papers-search"
            />
          </View>
        ) : null}

        {progress}

        {!searchOpen && total > 0 ? (
          <View
            style={styles.grid}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('papers.categories')}
            testID="papers-groups"
          >
            {PAPER_GROUPS.map((g, i) => {
              const look = PAPER_GROUP_LOOK[g];
              const tint = tintOf(g);
              const selected = group === g;
              const n = counts[g];
              return (
                <Reveal key={g} index={i} style={styles.tileSlot}>
                  <PressableScale
                    onPress={() => setGroup(selected ? null : g)}
                    disabled={n === 0}
                    accessibilityRole="radio"
                    accessibilityLabel={t('papers.categoryLabel', { name: t(look.label), n })}
                    accessibilityState={{ selected, checked: selected, disabled: n === 0 }}
                    style={[styles.tile, selected ? styles.tileOn : null, n === 0 ? styles.tileEmpty : null]}
                    testID={`papers-group-${g}`}
                  >
                    <View style={[styles.tileIcon, { backgroundColor: tint.bg }]}>
                      <Icon name={look.icon} size={24} color={tint.ink} strokeWidth={1.9} />
                    </View>
                    <AppText variant="labelStrong" numberOfLines={2}>
                      {t(look.label)}
                    </AppText>
                    <AppText variant="small" color={selected ? 'onPrimarySoft' : 'textMuted'}>
                      {String(n)}
                    </AppText>
                    {selected ? (
                      <View style={styles.tileCheck}>
                        <Icon name="check" size={16} color={Colors.onPrimary} strokeWidth={2.5} />
                      </View>
                    ) : null}
                  </PressableScale>
                </Reveal>
              );
            })}
          </View>
        ) : null}

        {!searchOpen ? (
          <Card flush style={[styles.gutter, styles.where]}>
            <ListRow
              icon="folder"
              title={t('papers.whereLooks')}
              subtitle={places.ready ? describePlaces(t, places) : undefined}
              onPress={() => navigation.navigate('PdfFolders')}
              last
              testID="papers-where"
            />
          </Card>
        ) : null}

        {total === 0 && !isSyncingDocs ? (
          <EmptyState
            icon="papers"
            title={t('papers.emptyTitle')}
            body={t('papers.emptyBody')}
            actionLabel={t('progress.findNewPapers')}
            onAction={findPapers}
            secondaryLabel={t('papers.add')}
            onSecondary={startAdd}
            testID="papers-empty"
          />
        ) : null}

        {total > 0 && debounced && shown.length === 0 ? (
          <EmptyState
            icon="search"
            title={t('papers.noMatchTitle', { q: debounced })}
            body={t('papers.noMatchBody')}
            testID="papers-no-match"
          />
        ) : null}

        {shown.length > 0 ? (
          <>
            {!debounced ? (
              <SectionHeader
                title={listTitle}
                actionLabel={group ? t('papers.showAll') : undefined}
                onAction={group ? () => setGroup(null) : undefined}
              />
            ) : (
              <View style={styles.searchGap} />
            )}
            <View style={styles.list}>
              {shown.slice(0, limit).map((paper, i) => (
                <Reveal key={paper.doc.filePath} index={i} playKey={`${group ?? 'all'}|${debounced}`}>
                  <PaperRow
                    paper={paper}
                    when={formatWhen(t, ago, paper.doc.timestamp)}
                    pinned={isPinned(paper.doc.filePath)}
                    onOpen={() => open(paper)}
                    onStar={() => star(paper)}
                    testID={`paper-${i}`}
                  />
                </Reveal>
              ))}
            </View>
            {shown.length > limit ? (
              <Button
                label={t('search.showMore', { n: Math.min(PAPERS_PAGE, shown.length - limit) })}
                onPress={() => setLimit(l => l + PAPERS_PAGE)}
                variant="ghost"
                style={styles.more}
                testID="papers-more"
              />
            ) : null}
          </>
        ) : null}

        {total > 0 && !searchOpen ? (
          <Button
            label={t('papers.add')}
            icon="plus"
            variant="secondary"
            block
            onPress={startAdd}
            style={[styles.gutter, styles.add]}
            testID="papers-add"
          />
        ) : null}
      </ScrollView>

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title={t('papers.addTitle')} testID="papers-add-sheet">
        <SheetAction
          icon="folder"
          label={t('papers.chooseFolder')}
          hint={t('papers.chooseFolderHint')}
          onPress={() => {
            setAddOpen(false);
            places.addFolder();
          }}
          testID="papers-add-folder"
        />
        <SheetAction
          icon="papers"
          label={t('papers.pickPdfs')}
          hint={t('papers.pickPdfsHint')}
          onPress={() => {
            setAddOpen(false);
            places.addFiles();
          }}
          testID="papers-add-files"
        />
        <View style={styles.tip}>
          <Icon name="share" size={20} color={Colors.textMuted} strokeWidth={2} />
          <AppText variant="small" color="textSecondary" style={styles.flex}>
            {t('papers.shareTip')}
          </AppText>
        </View>
      </Sheet>
    </Screen>
  );
};

interface PaperRowProps {
  paper: Paper;
  when: string;
  pinned: boolean;
  onOpen: () => void;
  onStar: () => void;
  testID?: string;
}

/** One paper: a tinted icon, its name, when it was added, its kind and a star. */
const PaperRow: React.FC<PaperRowProps> = ({ paper, when, pinned, onOpen, onStar, testID }) => {
  const { t } = useStrings();
  const look = PAPER_GROUP_LOOK[paper.group];
  const tint = tintOf(paper.group);
  const title = paper.title || t('papers.untitled');
  const added = t('papers.added', { when });
  return (
    <Card style={styles.rowCard} testID={testID}>
      <PressableScale
        onPress={onOpen}
        pressedScale={0.985}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${t(look.kind)}, ${added}`}
        style={styles.rowMain}
        testID={testID ? `${testID}-open` : undefined}
      >
        <View style={[styles.rowIcon, { backgroundColor: tint.bg }]}>
          <Icon name="papers" size={26} color={tint.ink} strokeWidth={1.75} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {title}
          </AppText>
          <View style={styles.meta}>
            <Tag label={t(look.kind)} tone={look.tint} />
            <AppText variant="small" color="textMuted" numberOfLines={1} style={styles.flexShrink}>
              {added}
            </AppText>
          </View>
        </View>
      </PressableScale>
      <IconButton
        icon="star"
        label={t('common.important')}
        accessibilityHint={t(pinned ? 'viewer.unmarkImportant' : 'viewer.markImportant')}
        selected={pinned}
        filled={pinned}
        iconColor={pinned ? Colors.important : Colors.textMuted}
        fillColor={Colors.importantStar}
        onPress={onStar}
        testID={testID ? `${testID}-star` : undefined}
      />
    </Card>
  );
};

const TILE_GAP = Space.sm + 2;

const styles = StyleSheet.create({
  content: { paddingBottom: Space.huge },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  gutter: { marginHorizontal: GUTTER, marginBottom: Space.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GUTTER,
    gap: TILE_GAP,
    marginBottom: Space.lg,
  },
  tileSlot: { width: '31.5%', flexGrow: 1 },
  tile: {
    minHeight: 120,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md - 2,
    borderWidth: 1.5,
    borderColor: Colors.line,
    padding: Space.md,
    gap: Space.xs + 2,
  },
  tileOn: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  tileEmpty: { opacity: 0.55 },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.xs + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileCheck: {
    position: 'absolute',
    top: Space.sm,
    right: Space.sm,
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  where: { marginBottom: 0 },
  searchGap: { height: Space.sm },
  list: { paddingHorizontal: GUTTER, gap: Space.md },
  rowCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: Space.sm, paddingLeft: Space.md, paddingRight: Space.xs },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: Touch.comfortable },
  rowIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.xxs },
  more: { alignSelf: 'center', marginTop: Space.sm },
  add: { marginTop: Space.xl },
  tip: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md },
});
