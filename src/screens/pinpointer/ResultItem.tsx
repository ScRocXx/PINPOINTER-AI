import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppText,
  HighlightedText,
  Icon,
  PressableScale,
  Reveal,
  Tag,
  Thumbnail,
} from '../../components/ui';
import { DocumentRecord } from '../../database';
import { useStrings } from '../../i18n';
import { Colors, Elevation, Radius, Space, Stagger, Tints, staggerDelay, Duration } from '../../theme';
import { describeResult } from './resultInfo';
import { MatchedSnippet } from './MatchedSnippet';
import { answerLine } from './answerLine';

/** Size of the photo or paper tile at the start of a row. */
export const RESULT_TILE = 76;

export interface ResultItemProps {
  item: DocumentRecord;
  /** What was searched. */
  query: string;
  /** Place in the list: rows rise in one after another. */
  index: number;
  /** Starred as Important. */
  pinned?: boolean;
  onPress: (item: DocumentRecord) => void;
  testID?: string;
}

/**
 * One search result: a big row that says Photo or Paper, shows the words
 * that matched (marked in cyan, the first one locked on with the corners),
 * and opens the photo or the PDF.
 */
export const ResultItem: React.FC<ResultItemProps> = React.memo(
  ({ item, query, index, pinned = false, onPress, testID = 'result-item' }) => {
    const { t, ago } = useStrings();
    const info = useMemo(() => describeResult(item, query), [item, query]);

    const kindWord = t(info.isPhoto ? 'search.photo' : 'search.paper');
    const answer = answerLine(t, info.facts);
    const paperWord = info.kind?.label ? t(info.kind.label) : null;
    const tint = info.kind ? Tints[info.kind.tint] : null;

    let mainText = info.snippet;
    if (info.isPhoto && info.isLabels && info.snippet) mainText = t('search.shows', { what: info.snippet });
    if (info.isPhoto && !info.wordsMatch && !info.isLabels) mainText = '';

    const spoken = [
      kindWord,
      paperWord,
      info.title,
      answer,
      mainText || (info.isPhoto ? t('search.looksLikeQuery', { q: query.trim() }) : ''),
      pinned ? t('common.important') : null,
    ]
      .filter(Boolean)
      .join('. ')
      .slice(0, 220);

    // Rise in by the place the row first appeared at: a re-rank or a filter
    // that moves it later doesn't replay the entrance.
    const [enteredAt] = useState(index);
    // The corners lock on just after the row has risen into place.
    const lockDelay = enteredAt < Stagger.max ? staggerDelay(enteredAt) + Duration.base - 40 : 0;

    return (
      <Reveal index={enteredAt}>
        <PressableScale
          onPress={() => onPress(item)}
          pressedScale={0.985}
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint={t(info.isPhoto ? 'search.openPhoto' : 'search.openPaper')}
          style={styles.row}
          testID={testID}
        >
          {info.isPhoto ? (
            <Thumbnail uri={item.filePath} size={RESULT_TILE} radius={Radius.sm} testID={`${testID}-thumb`} />
          ) : (
            <View style={[styles.tile, { backgroundColor: tint?.bg ?? Colors.sunken }]} testID={`${testID}-tile`}>
              <Icon name={info.kind?.icon ?? 'papers'} size={32} color={tint?.ink ?? Colors.text} strokeWidth={1.9} />
            </View>
          )}

          <View style={styles.body}>
            <View style={styles.meta}>
              <Tag label={kindWord} icon={info.isPhoto ? 'photos' : 'papers'} tone="neutral" />
              {paperWord ? <Tag label={paperWord} tone={info.kind?.tint ?? 'neutral'} /> : null}
              {info.isPhoto && !info.wordsMatch ? <Tag label={t('search.looksLike')} tone="bank" /> : null}
              {pinned ? (
                <View style={styles.star} testID={`${testID}-important`}>
                  <Icon name="star" size={20} filled color={Colors.important} fillColor={Colors.importantStar} strokeWidth={1.6} />
                </View>
              ) : null}
            </View>

            {info.title ? (
              <HighlightedText
                text={info.title}
                terms={info.terms}
                variant="bodyStrong"
                color={Colors.text}
                numberOfLines={2}
              />
            ) : null}

            {answer ? (
              <AppText variant="bodyStrong" color="text" numberOfLines={2} testID={`${testID}-answer`}>
                {answer}
              </AppText>
            ) : null}

            {mainText ? (
              <MatchedSnippet
                text={mainText}
                terms={info.terms}
                variant={info.isPhoto ? 'body' : 'small'}
                color={info.isPhoto ? Colors.text : Colors.textSecondary}
                numberOfLines={info.isPhoto ? 3 : 2}
                lockOn={!info.isLabels}
                delay={lockDelay}
                testID={`${testID}-snippet`}
              />
            ) : info.isPhoto ? (
              <AppText variant="body" color="textSecondary" numberOfLines={2}>
                {t('search.looksLikeQuery', { q: query.trim() })}
              </AppText>
            ) : null}

            {!info.isPhoto && item.timestamp ? (
              <AppText variant="small" color="textMuted" numberOfLines={1}>
                {t('papers.added', { when: ago(item.timestamp) })}
              </AppText>
            ) : null}
          </View>
        </PressableScale>
      </Reveal>
    );
  },
);
ResultItem.displayName = 'ResultItem';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md + 2,
    padding: Space.md + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    ...Elevation.rest,
  },
  tile: {
    width: RESULT_TILE,
    height: RESULT_TILE,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: Space.xs },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.xs + 2 },
  star: { marginLeft: 'auto' },
});
