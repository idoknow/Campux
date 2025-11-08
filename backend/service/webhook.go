package service

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/RockChinQ/Campux/backend/database"
)

type WebhookService struct {
	CommonService
}

func NewWebhookService(db database.BaseDBManager) *WebhookService {
	return &WebhookService{
		CommonService: CommonService{
			DB: db,
		},
	}
}

// WebhookEvent represents the data structure sent to webhooks
type WebhookEvent struct {
	Event     string            `json:"event"`
	Post      *database.PostPO  `json:"post"`
	Timestamp int64             `json:"timestamp"`
}

// AddWebhook adds a new webhook URL
func (ws *WebhookService) AddWebhook(url string) error {
	webhook := &database.WebhookPO{
		URL: url,
	}
	return ws.DB.AddWebhook(webhook)
}

// GetWebhooks retrieves all webhook URLs
func (ws *WebhookService) GetWebhooks() ([]database.WebhookPO, error) {
	return ws.DB.GetWebhooks()
}

// DeleteWebhook deletes a webhook by ID
func (ws *WebhookService) DeleteWebhook(id int) error {
	return ws.DB.DeleteWebhook(id)
}

// NotifyWebhooks sends a webhook event to all registered webhooks
func (ws *WebhookService) NotifyWebhooks(event string, post *database.PostPO) {
	webhooks, err := ws.DB.GetWebhooks()
	if err != nil {
		return
	}

	webhookEvent := WebhookEvent{
		Event:     event,
		Post:      post,
		Timestamp: time.Now().Unix(),
	}

	jsonData, err := json.Marshal(webhookEvent)
	if err != nil {
		return
	}

	// Send webhooks asynchronously
	for _, webhook := range webhooks {
		go func(url string) {
			client := &http.Client{
				Timeout: 10 * time.Second,
			}
			_, _ = client.Post(url, "application/json", bytes.NewBuffer(jsonData))
		}(webhook.URL)
	}
}
