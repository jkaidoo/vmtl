<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\File;

class AppHealthController extends Controller
{
    public function index(): JsonResponse
    {
        $since = now()->subDays(7);

        $successful = AuditLog::where('action', 'auth.login')->where('created_at', '>=', $since);
        $failed = AuditLog::whereIn('action', ['auth.login_failed', 'auth.login_blocked'])->where('created_at', '>=', $since);

        return response()->json([
            'data' => [
                'stats' => [
                    'successful_signins' => (clone $successful)->count(),
                    'failed_signins' => (clone $failed)->count(),
                    'events_7d' => AuditLog::where('created_at', '>=', $since)->count(),
                    'errors_recent' => count($this->recentErrors(50)),
                ],
                'successful_signins' => AuditLogResource::collection((clone $successful)->with('user')->latest('created_at')->limit(15)->get()),
                'failed_signins' => AuditLogResource::collection((clone $failed)->latest('created_at')->limit(15)->get()),
                'recent_events' => AuditLogResource::collection(AuditLog::with('user')->latest('created_at')->limit(20)->get()),
                'error_log' => $this->recentErrors(50),
            ],
        ]);
    }

    /**
     * Tail the application log and pull the most recent error lines.
     *
     * @return array<int, array{level:string, timestamp:string, message:string}>
     */
    private function recentErrors(int $limit): array
    {
        $path = storage_path('logs/laravel.log');
        if (! File::exists($path)) {
            return [];
        }

        // Read a bounded tail of the file to avoid loading huge logs.
        $size = filesize($path);
        $bytes = min($size, 256 * 1024);
        $content = file_get_contents($path, false, null, $size - $bytes) ?: '';

        $errors = [];
        foreach (explode("\n", $content) as $line) {
            if (preg_match('/^\[(?<ts>[^\]]+)\].*?\.(?<level>ERROR|CRITICAL|EMERGENCY|ALERT):\s*(?<msg>.*)$/', $line, $m)) {
                $errors[] = [
                    'level' => $m['level'],
                    'timestamp' => $m['ts'],
                    'message' => mb_substr($m['msg'], 0, 300),
                ];
            }
        }

        return array_slice(array_reverse($errors), 0, $limit);
    }
}
