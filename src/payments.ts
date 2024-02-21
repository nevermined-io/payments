import { EnvironmentInfo, EnvironmentName, Environments } from "./environments";

export interface PaymentOptions {
  returnUrl: string;
  environment: EnvironmentName;
}

export class Payments {
  public returnUrl: string;
  public environment: EnvironmentInfo;
  private sessionKey?: string;

  constructor(options: PaymentOptions) {
    this.returnUrl = options.returnUrl;
    this.environment = Environments[options.environment];
  }

  public init() {
    const url = new URL(window.location.href);
    const sessionKey = url.searchParams.get("sessionKey");
    if (sessionKey) {
      this.sessionKey = sessionKey;
      console.log("sessionKey:", sessionKey);
      url.searchParams.delete("sessionKey");
      history.replaceState(history.state, "", url.toString());
    }
  }

  public connect() {
    const url = new URL(
      `/en/login?nvm-export=session-key&returnUrl=${this.returnUrl}`,
      this.environment.frontend
    );
    window.location.href = url.toString();
  }

  public isLoggedIn(): boolean {
    return !!this.sessionKey;
  }

  public async createSubscription(
    name: string,
    description: string,
    price: bigint,
    tokenAddress: string,
    amountOfCredits?: number,
    duration?: number,
    tags?: string[]
  ): Promise<{ did: string }> {
    const body = {
      sessionKey: this.sessionKey,
      name,
      description,
      price: price.toString(),
      tokenAddress,
      amountOfCredits,
      duration,
      tags,
    };
    const options = {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    };
    const url = new URL("/api/v1/payments", this.environment.backend);

    const response = await fetch(url, options);
    if (!response.ok) {
      throw Error(response.statusText);
    }

    return response.json();
  }
}
