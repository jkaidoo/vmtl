<?php

namespace App\Notifications;

use App\Models\VehicleRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class RequestRejectedNotification extends Notification
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
            ->subject("Vehicle request {$this->request->request_number} rejected")
            ->line("Your vehicle request {$this->request->request_number} has been rejected.")
            ->line("Reason: {$this->reason}");
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'request.rejected',
            'title' => 'Request rejected',
            'message' => "Request {$this->request->request_number} was rejected",
            'vehicle_request_id' => $this->request->id,
            'request_number' => $this->request->request_number,
            'reason' => $this->reason,
        ];
    }
}
