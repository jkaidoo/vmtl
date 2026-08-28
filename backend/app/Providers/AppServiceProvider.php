<?php

namespace App\Providers;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->enforceTokenIdleTimeout();
    }

    /**
     * Reject (and revoke) any Sanctum token that has been idle longer than the
     * configured window. This runs during token validation — before Sanctum
     * refreshes "last_used_at" — so we see the genuine last-use time. Backstops
     * the client-side idle logout for tokens orphaned by a closed/crashed tab.
     */
    protected function enforceTokenIdleTimeout(): void
    {
        Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $accessToken, bool $isValid): bool {
            if (! $isValid) {
                return false;
            }

            // Mobile PWA is exempt from idle logout (matches the client policy in
            // frontend/src/lib/idle.ts — an installed app on a phone/tablet is
            // treated like a native app). The client labels the token at login.
            if ($accessToken->name === 'mobile-pwa') {
                return true;
            }

            $idleMinutes = (int) config('sanctum.idle_timeout', 0);
            $lastUsed = $accessToken->last_used_at;

            if ($idleMinutes > 0 && $lastUsed && $lastUsed->lt(now()->subMinutes($idleMinutes))) {
                Log::info('Sanctum token expired after inactivity', [
                    'token_id' => $accessToken->getKey(),
                    'tokenable_id' => $accessToken->tokenable_id,
                    'last_used_at' => $lastUsed->toIso8601String(),
                    'idle_minutes' => $idleMinutes,
                ]);

                // Revoke so the stale token can never be reused, then reject.
                $accessToken->delete();

                return false;
            }

            return true;
        });
    }
}
