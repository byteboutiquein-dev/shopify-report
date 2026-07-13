export const statusOptions = {
  confirmText: ["Pending", "Sent", "Failed", "Not Needed"],
  trackingText: ["Pending", "Sent", "Failed", "Not Needed"],
  reviewText: ["Pending", "Sent", "Received", "Failed", "Not Needed"],
  tracking: ["Pending", "Sent", "In Transit", "Delivered", "Failed"],
  delivery: ["Not Shipped", "Shipped", "In Transit", "Delivered", "Returned", "Issue"],
  sync: ["Success", "Partial", "Failed"]
} as const;
