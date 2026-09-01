export const statusOptions = {
  confirmText: ["Pending", "Sent", "Failed", "Not Needed"],
  trackingText: ["Pending", "Sent", "Failed", "Not Needed"],
  reviewText: ["Pending", "Sent", "Received", "Failed", "Not Needed"],
  tracking: ["Pending", "Sent", "In Transit", "Delivered", "Failed"],
  delivery: ["Not Shipped", "Tracking Added", "In Transit", "Check Failed", "Delivered", "Returned", "Issue"],
  sync: ["Success", "Partial", "Failed"]
} as const;
