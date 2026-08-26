<?php

namespace App\Notifications\Channels;

use App\Services\WebPushService;
use Illuminate\Notifications\Notification;

class WebPushChannel
{
    public function __construct(private readonly WebPushService $push) {}

    public function send(object $notifiable, Notification $notification): void
    {
        if (! method_exists($notification, 'toArray') || ! method_exists($notifiable, 'pushSubscriptions')) {
            return;
        }

        /** @var array<string,mixed> $data */
        $data = $notification->toArray($notifiable);

        $this->push->sendToUser($notifiable, [
            'title' => $data['title'] ?? 'UITS VMTL',
            'body' => $data['message'] ?? '',
            'tag' => $data['type'] ?? 'uits-vmtl',
            'url' => $this->urlFor($data),
        ]);
    }

    /** @param array<string,mixed> $data */
    private function urlFor(array $data): string
    {
        if (! empty($data['vehicle_request_id'])) {
            return '/requests/'.$data['vehicle_request_id'];
        }
        if (! empty($data['trip_id'])) {
            return '/trips/'.$data['trip_id'];
        }

        return '/dashboard';
    }
}
