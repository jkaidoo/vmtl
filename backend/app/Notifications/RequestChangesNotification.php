<?php

namespace App\Notifications;

use App\Models\VehicleRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class RequestChangesNotification extends Notification
{
    use Queueable;

    public function __construct(public VehicleRequest $request, public string $reason) {}

    /** @return array<int,string> */
    public function via(object $notifiable): array
    {
        return ['database', 'mail', \App\Notifications\Channels\WebPushChannel::class];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("Changes requested on {$this->request->request_number}")
            ->line("Changes were requested on your vehicle request {$this->request->request_number}.")
            ->line("What to change: {$this->reason}")
            ->line('Please edit your request and resubmit it for review.');
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'request.changes_requested',
            'title' => 'Changes requested',
            'message' => "Changes were requested on {$this->request->request_number}",
            'vehicle_request_id' => $this->request->id,
            'request_number' => $this->request->request_number,
            'reason' => $this->reason,
        ];
    }
}
