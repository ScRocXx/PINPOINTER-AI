/**
 * @format
 */
import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';
import {
  BACKGROUND_TASK_KEY,
  runBackgroundIndexing,
} from './src/services/BackgroundIndexingTask';

AppRegistry.registerComponent(appName, () => App);
// Started by Android's IndexingJobService while the phone is charging.
AppRegistry.registerHeadlessTask(BACKGROUND_TASK_KEY, () => runBackgroundIndexing);
