<?php

namespace App\Services;

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Throwable;

class WebPushService
{
    private ?WebPush $client = null;

    public function __construct()
    {
        // EC (VAPID) signing needs an OpenSSL config on Windows.
        $conf = config('webpush.openssl_conf');
        if ($conf && ! getenv('OPENSSL_CONF')) {
            putenv('OPENSSL_CONF='.$conf);
        }
    }

    private function isConfigured(): bool
    {
        return (bool) config('webpush.vapid.public_key') && (bool) config('webpush.vapid.private_key');
    }

    private function client(): ?WebPush
    {
        if (! $this->isConfigured()) {
            return null;
        }

        return $this->client ??= new WebPush([
            'VAPID' => [
                'subject' => config('webpush.vapid.subject'),
                'publicKey' => config('webpush.vapid.public_key'),
                'privateKey' => config('webpush.vapid.private_key'),
            ],
        ]);
    }

    /**
     * Send a push payload to every device a user has registered.
     * Expired/gone subscriptions are pruned automatically.
     *
     * @param  array<string,mixed>  $payload  (title, body, url, tag, …)
     */
    public function sendToUser(User $user, array $payload): void
    {
        $client = $this->client();
        if (! $client) {
            return; // push not configured — silently no-op
        }

        $subscriptions = $user->pushSubscriptions()->get();
        if ($subscriptions->isEmpty()) {
            return;
        }

        try {
            foreach ($subscriptions as $sub) {
                $client->queueNotification(
                    Subscription::create([
                        'endpoint' => $sub->endpoint,
                        'publicKey' => $sub->public_key,
                        'authToken' => $sub->auth_token,
                        'contentEncoding' => $sub->content_encoding ?: 'aesgcm',
                    ]),
                    json_encode($payload)
                );
            }

            foreach ($client->flush() as $report) {
                if (! $report->isSuccess() && $report->isSubscriptionExpired()) {
                    PushSubscription::where('endpoint_hash', hash('sha256', $report->getEndpoint()))->delete();
                }
            }
        } catch (Throwable $e) {
            Log::warning('Web push send failed: '.$e->getMessage());
        }
    }
}
