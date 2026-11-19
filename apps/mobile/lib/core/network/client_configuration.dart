class ClientConfiguration {
  const ClientConfiguration({
    this.imageGeneration = false,
    this.imageEditing = false,
    this.apple = false,
    this.google = false,
    this.pushConfigured = false,
  });
  final bool imageGeneration, imageEditing, apple, google, pushConfigured;
  factory ClientConfiguration.fromJson(Map<String, dynamic> value) {
    final tools = value['tools'] as Map<String, dynamic>? ?? {},
        auth = value['auth'] as Map<String, dynamic>? ?? {};
    return ClientConfiguration(
      imageGeneration: tools['imageGeneration'] == true,
      imageEditing: tools['imageEditing'] == true,
      apple: auth['apple'] == true,
      google: auth['google'] == true,
      pushConfigured: value['pushConfigured'] == true,
    );
  }
}
