package ai.runanywhere.starter

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Schedules IndexingJobService as a periodic job that only runs while the
 * phone is charging and the battery and storage aren't low, so a first sync
 * of thousands of photos never drains a weak battery.
 */
class IndexingSchedulerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val JOB_ID = 4711
        private const val INTERVAL_MS = 6L * 60 * 60 * 1000 // at most every 6 hours
        private const val FLEX_MS = 2L * 60 * 60 * 1000
    }

    override fun getName() = "IndexingScheduler"

    private val scheduler: JobScheduler
        get() = reactApplicationContext.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler

    /**
     * Schedules the job unless it already is. Rescheduling would reset its
     * timer, so calling this on every app start is safe and cheap.
     * Resolves true when the job is (now) scheduled.
     */
    @ReactMethod
    fun schedule(promise: Promise) {
        try {
            if (scheduler.getPendingJob(JOB_ID) != null) {
                promise.resolve(true)
                return
            }
            val builder = JobInfo.Builder(JOB_ID, ComponentName(reactApplicationContext, IndexingJobService::class.java))
                .setRequiresCharging(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
                .setPeriodic(INTERVAL_MS, FLEX_MS)
                .setPersisted(true) // survives reboot (RECEIVE_BOOT_COMPLETED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder.setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true)
            }
            promise.resolve(scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_FAILED", e)
        }
    }

    /** Stops background indexing (e.g. if the user turns it off). */
    @ReactMethod
    fun cancel(promise: Promise) {
        scheduler.cancel(JOB_ID)
        promise.resolve(true)
    }

    @ReactMethod
    fun isScheduled(promise: Promise) {
        promise.resolve(scheduler.getPendingJob(JOB_ID) != null)
    }
}
