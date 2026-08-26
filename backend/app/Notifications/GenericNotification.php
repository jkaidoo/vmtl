<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Lightweight in-app / email / web-push notification with a free-form message. */
class GenericNotification extends Notification
{
    use Queueable;

    /** @param array<string,mixed> $extra */
    public function __construct(
        public string $type,
        public string $title,
        public string $message,
        public ?string $url = null,
        public array $extra = [],
    ) {}

    /** @return array<int,string> */
    public function via(object $notifiable): array
    {
        return ['database', 'mail', \App\Notifications\Channels\WebPushChannel::class];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)->subject($this->title)->line($this->message);
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return array_merge([
            'type' => $this->type,
            'title' => $this->title,
            'message' => $this->message,
        ], $this->extra);
    }
}
