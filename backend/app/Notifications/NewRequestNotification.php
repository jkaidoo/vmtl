<?php

namespace App\Notifications;

use App\Models\VehicleRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class NewRequestNotification extends Notification
{
    use Queueable;

    public function __construct(public VehicleRequest $request) {}

    /** @return array<int,string> */
    public function via(object $notifiable): array
    {
        return ['database', 'mail', \App\Notifications\Channels\WebPushChannel::class];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("New vehicle request {$this->request->request_number}")
            ->line("A new vehicle request ({$this->request->request_number}) is awaiting approval.")
            ->line("Requester: {$this->request->requester?->name}")
            ->line("Destination: {$this->request->destination}")
            ->line("Travel date: {$this->request->travel_date?->toDateString()}");
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'request.created',
            'title' => 'New vehicle request',
            'message' => "{$this->request->requester?->name} submitted request {$this->request->request_number}",
            'vehicle_request_id' => $this->request->id,
            'request_number' => $this->request->request_number,
        ];
    }
}
