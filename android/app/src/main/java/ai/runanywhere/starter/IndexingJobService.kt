package ai.runanywhere.starter

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * Runs gallery indexing in the background, only when JobScheduler's
 * conditions hold (charging, battery not low, storage not low; see
 * IndexingSchedulerModule). It starts the JS task registered in index.js
 * (src/services/BackgroundIndexingTask.ts), which runs the same
 * IndexingService queue the app uses.
 *
 * Uses the platform JobScheduler, not WorkManager, so it adds nothing to the APK.
 *
 * The JS task stops itself after BUDGET_MS. If the conditions stop holding
 * first (phone unplugged), onStopJob tells JS to pause; deep sync keeps its
 * cursor and the next run carries on from there.
 */
class IndexingJobService : JobService(), HeadlessJsTaskEventListener {

    companion object {
        private const val TAG = "IndexingJob"
        /** Must match BACKGROUND_TASK_KEY in BackgroundIndexingTask.ts. */
        const val TASK_KEY = "PinpointerBackgroundIndexing"
        /** Must match STOP_EVENT in BackgroundIndexingTask.ts. */
        const val STOP_EVENT = "PinpointerBackgroundIndexingStop"
        /** JobScheduler allows about 10 minutes per run; leave room to wind down. */
        const val BUDGET_MS = 8L * 60 * 1000
        private const val GRACE_MS = 60L * 1000
    }

    private var params: JobParameters? = null
    private var reactContext: ReactContext? = null
    private var taskId: Int? = null

    override fun onStartJob(jobParams: JobParameters): Boolean {
        params = jobParams
        val host = (application as ReactApplication).reactHost
        if (host == null) {
            Log.w(TAG, "No ReactHost, skipping this run")
            return false
        }
        val current = host.currentReactContext
        if (current != null) {
            startTask(current)
        } else {
            host.addReactInstanceEventListener(object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) {
                    host.removeReactInstanceEventListener(this)
                    startTask(context)
                }
            })
            host.start()
        }
        return true // work continues on the JS side; finish() reports back
    }

    private fun startTask(context: ReactContext) {
        UiThreadUtil.runOnUiThread {
            try {
                val tasks = HeadlessJsTaskContext.getInstance(context)
                tasks.addTaskEventListener(this)
                reactContext = context
                val data = Arguments.createMap().apply { putDouble("budgetMs", BUDGET_MS.toDouble()) }
                // Not allowed in the foreground: when the app is open, its own sync runs instead.
                taskId = tasks.startTask(HeadlessJsTaskConfig(TASK_KEY, data, BUDGET_MS + GRACE_MS, false))
            } catch (e: Exception) {
                Log.i(TAG, "Background indexing not started: ${e.message}")
                finish()
            }
        }
    }

    override fun onHeadlessJsTaskStart(taskId: Int) = Unit

    override fun onHeadlessJsTaskFinish(taskId: Int) {
        if (taskId == this.taskId) finish()
    }

    override fun onStopJob(jobParams: JobParameters): Boolean {
        // Conditions no longer hold (e.g. unplugged): ask JS to pause, cursor is saved.
        try {
            reactContext?.emitDeviceEvent(STOP_EVENT)
        } catch (e: Exception) {
            Log.w(TAG, "Could not signal JS to stop", e)
        }
        cleanup()
        params = null
        return false // periodic job: the next run picks up where this one stopped
    }

    private fun finish() {
        cleanup()
        params?.let { jobFinished(it, false) }
        params = null
    }

    private fun cleanup() {
        reactContext?.let { HeadlessJsTaskContext.getInstance(it).removeTaskEventListener(this) }
        reactContext = null
        taskId = null
    }
}
