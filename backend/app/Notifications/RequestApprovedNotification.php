<?php

namespace App\Notifications;

use App\Models\VehicleRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class RequestApprovedNotification extends Notification
{
    use Queueable;

    public function __construct(public VehicleRequest $request, public ?string $comment = null) {}

    /** @return array<int,string> */
    public function via(object $notifiable): array
    {
        return ['database', 'mail', \App\Notifications\Channels\WebPushChannel::class];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject("Vehicle request {$this->request->request_number} approved")
            ->line("Your vehicle request {$this->request->request_number} has been approved.");

        if ($this->comment) {
            $mail->line("Comment: {$this->comment}");
        }

        return $mail;
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'request.approved',
            'title' => 'Request approved',
            'message' => "Request {$this->request->request_number} was approved",
            'vehicle_request_id' => $this->request->id,
            'request_number' => $this->request->request_number,
            'comment' => $this->comment,
        ];
    }
}
