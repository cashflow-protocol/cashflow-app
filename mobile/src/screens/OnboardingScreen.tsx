import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { logScreenView, logOnboardingNext, logOnboardingHaveInviteCode, logOnboardingJoinWaitlist, logOnboardingPageView } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';


const { width: SCREEN_WIDTH } = Dimensions.get('window');


interface OnboardingScreenProps {
  onHaveInviteCode: () => void;
  onJoinWaitlist: () => void;
}

// --- Inline SVG Icons ---

function YieldIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M29.6875 7.17337C29.9331 7.66806 29.7312 8.26816 29.2365 8.51373C28.7418 8.75931 28.1417 8.55737 27.8961 8.06269L27.2623 6.78598L20.6338 20.8227C19.7703 22.6514 17.2059 22.7514 16.2026 20.9956L11.2166 12.2701C11.0065 11.9024 10.463 11.9461 10.3143 12.3426L3.93611 29.3512C3.74219 29.8683 3.16578 30.1303 2.64866 29.9364C2.13154 29.7425 1.86953 29.1661 2.06345 28.6489L8.44167 11.6403C9.18515 9.65775 11.9026 9.43936 12.9531 11.2778L17.9391 20.0033C18.1398 20.3545 18.6526 20.3345 18.8253 19.9687L25.5303 5.76992L23.6752 6.69087C23.1805 6.93645 22.5804 6.73451 22.3349 6.23983C22.0893 5.74515 22.2912 5.14505 22.7859 4.89947L26.5216 3.04495C27.0163 2.79937 27.6164 3.00131 27.8619 3.49599L29.6875 7.17337Z"
        fill="#fff"
      />
    </Svg>
  );
}

function KeyIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.9291 28.9449C17.5406 28.5507 17.544 27.9177 17.9367 27.5311L18.8016 26.6794L17.9011 25.7278L15.0217 28.4791C14.6233 28.8598 13.9901 28.8443 13.6075 28.4444C13.2249 28.0445 13.2377 27.4116 13.6362 27.0309L16.5234 24.272L10.0655 17.448C9.25862 17.9515 8.29973 18.2313 7.27781 18.2031C4.51105 18.1268 2.32997 15.8221 2.40624 13.0553C2.4825 10.2886 4.78723 8.10749 7.55399 8.18376C10.3207 8.26002 12.5018 10.5647 12.4256 13.3315C12.3974 14.3534 12.0652 15.2954 11.5181 16.0732L21.8713 27.0133C22.2509 27.4145 22.2334 28.0474 21.8323 28.427C21.4312 28.8066 20.7982 28.7892 20.4186 28.3881L20.1795 28.1354L19.3436 28.9585C18.951 29.3452 18.3177 29.3391 17.9291 28.9449ZM7.33292 16.2038C5.67031 16.158 4.35965 14.7731 4.40548 13.1104C4.45131 11.4478 5.83627 10.1372 7.49888 10.183C9.16149 10.2288 10.4722 11.6138 10.4263 13.2764C10.3805 14.939 8.99553 16.2497 7.33292 16.2038Z"
        fill="#fff"
      />
      <Path
        d="M11.9564 8.02482C12.036 6.20078 10.6797 4.7213 9.00428 4.64816C7.91188 4.60048 7.25778 5.07305 6.84453 5.56637C6.62945 5.82311 6.48068 6.08745 6.38622 6.28874C6.33957 6.38816 6.3078 6.46867 6.28892 6.52025C6.27952 6.54593 6.27343 6.5641 6.27039 6.57346L6.26828 6.58008C6.11206 7.10646 5.56 7.40887 5.03172 7.25602C4.5012 7.10253 4.19555 6.54802 4.34905 6.01749L5.30965 6.29542C4.34905 6.01749 4.34933 6.01653 4.34933 6.01653L4.34963 6.0155L4.35029 6.01325L4.35185 6.00797L4.35598 5.99431C4.35918 5.98387 4.3633 5.97074 4.36838 5.95512C4.37853 5.92391 4.39255 5.88259 4.41083 5.83266C4.44732 5.73301 4.5012 5.59778 4.57567 5.43909C4.72345 5.12417 4.95883 4.70291 5.31138 4.28206C6.03337 3.42018 7.24838 2.56961 9.0915 2.65007C11.7277 2.76515 13.7607 4.90068 13.9459 7.48874L27.8822 11.9203C28.4085 12.0877 28.6995 12.65 28.5322 13.1764C28.3648 13.7027 27.8025 13.9937 27.2762 13.8263L26.9449 13.7209L26.6116 14.8458C26.4551 15.3742 25.8979 15.6754 25.3671 15.5184C24.8364 15.3614 24.5331 14.8059 24.6896 14.2775L25.0345 13.1135L23.7861 12.7165L22.5975 16.5178C22.433 17.0438 21.8714 17.3366 21.343 17.1718C20.8147 17.0069 20.5197 16.4469 20.6842 15.9209L21.8761 12.1091L12.8029 9.22398C12.5518 9.14413 12.3543 8.97436 12.2345 8.76149C12.0516 8.57121 11.9439 8.30931 11.9564 8.02482Z"
        fill="#fff"
      />
    </Svg>
  );
}

function TicketIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 7C2.89543 7 2 7.89543 2 9V12.17C2 12.5842 2.28215 12.9467 2.68 13.0575C3.97817 13.4179 4.93333 14.5942 4.93333 16C4.93333 17.4058 3.97817 18.5821 2.68 18.9425C2.28215 19.0533 2 19.4158 2 19.83V23C2 24.1046 2.89543 25 4 25H28C29.1046 25 30 24.1046 30 23V19.83C30 19.4158 29.7179 19.0533 29.32 18.9425C28.0218 18.5821 27.0667 17.4058 27.0667 16C27.0667 14.5942 28.0218 13.4179 29.32 13.0575C29.7179 12.9467 30 12.5842 30 12.17V9C30 7.89543 29.1046 7 28 7H4ZM12 9H4V11.4222C5.43927 12.3782 6.4 14.0384 6.4 15.9167C6.4 17.795 5.43927 19.4552 4 20.4111V23H12V9ZM14 23H28V20.5778C26.5607 19.6218 25.6 17.9616 25.6 16.0833C25.6 14.205 26.5607 12.5448 28 11.5889V9H14V23Z"
        fill="#fff"
      />
    </Svg>
  );
}

function SecurityIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M20.7893 13.6139C21.1284 13.178 21.0498 12.5497 20.6139 12.2106C20.1779 11.8716 19.5497 11.9501 19.2106 12.386L15.2359 17.4964L12.7035 14.9893C12.311 14.6008 11.6779 14.604 11.2893 14.9964C10.9007 15.3889 10.9039 16.0221 11.2964 16.4106L14.6297 19.7106C14.833 19.9118 15.1126 20.0164 15.3979 19.9979C15.6833 19.9794 15.9471 19.8396 16.1226 19.6139L20.7893 13.6139Z"
        fill="#fff"
      />
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.4855 2.51717C16.5318 2.13571 15.468 2.13571 14.5143 2.51718L6.78572 5.60863C5.72622 6.03244 4.98504 7.02752 4.92694 8.19213C4.86703 9.39302 4.80062 11.3155 4.8529 13.3062C4.90459 15.2743 5.07354 17.3974 5.51728 18.9569C6.21927 21.4239 7.95172 23.6306 9.70252 25.3626C11.4685 27.1096 13.3426 28.4604 14.4573 29.204C15.3948 29.8294 16.605 29.8294 17.5425 29.204C18.6572 28.4604 20.5312 27.1096 22.2972 25.3626C24.0481 23.6306 25.7805 21.4239 26.4825 18.9569C26.9262 17.3974 27.0952 15.2743 27.1469 13.3063C27.1992 11.3155 27.1328 9.39305 27.0729 8.19215C27.0148 7.02753 26.2736 6.03243 25.2141 5.60863L17.4855 2.51717ZM15.2571 4.37413C15.7339 4.1834 16.2658 4.1834 16.7427 4.37413L24.4713 7.46558C24.8284 7.60843 25.0574 7.93255 25.0754 8.29179C25.1339 9.4661 25.198 11.3332 25.1476 13.2537C25.0965 15.197 24.9295 17.1068 24.5589 18.4095C23.9958 20.3884 22.5473 22.3019 20.8907 23.9407C19.2493 25.5645 17.4893 26.8353 16.4326 27.5402C16.1671 27.7173 15.8326 27.7173 15.5672 27.5402C14.5105 26.8353 12.7505 25.5645 11.1091 23.9407C9.45243 22.3019 8.00402 20.3884 7.44091 18.4095C7.07024 17.1068 6.90325 15.197 6.85221 13.2537C6.80177 11.3332 6.86587 9.46609 6.92446 8.29179C6.94238 7.93255 7.17139 7.60843 7.52851 7.46558L15.2571 4.37413Z"
        fill="#fff"
      />
    </Svg>
  );
}

// --- Page Data ---

interface PageData {
  key: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const PAGES: PageData[] = [
  {
    key: 'yield',
    icon: <YieldIcon size={100} />,
    title: 'Wealth Engine',
    description: 'Earn yield across top DeFi protocols,\nbuy gold, tokenized stocks, and more.\nYour assets work for you, 24/7.',
  },
  {
    key: 'non-custodial',
    icon: <KeyIcon size={100} />,
    title: 'Your Keys, Your Crypto',
    description: 'Cashflow is fully self-custodial. You own your private keys and control your funds at all times. No middlemen, no compromises.',
  },
  {
    key: 'security',
    icon: <SecurityIcon size={100} />,
    title: 'Multi-Layer Security',
    description: 'Multisig protection with Squads Protocol. Works with Solana Mobile and hardware wallets. No single point of failure.',
  },
  {
    key: 'early-access',
    icon: <TicketIcon size={100} />,
    title: 'Early Access',
    description: 'Cashflow is currently invite-only.\nEnter your invite code to get started,\nor join the waitlist to earn your spot.',
  },
];

export default function OnboardingScreen({ onHaveInviteCode, onJoinWaitlist }: OnboardingScreenProps) {
  const { colors } = useTheme();
  const flatListRef = useRef<FlatList>(null);
  const [currentPage, setCurrentPage] = useState(0);
  useEffect(() => { logScreenView('OnboardingScreen'); }, []);

  const isLastPage = currentPage === PAGES.length - 1;

  const handleNext = useCallback(() => {
    if (currentPage < PAGES.length - 1) {
      logOnboardingNext(currentPage);
      const next = currentPage + 1;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setCurrentPage(next);
    }
  }, [currentPage]);

  const onScroll = useCallback((e: any) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (page !== currentPage) {
      logOnboardingPageView(PAGES[page]?.key ?? String(page), page);
    }
    setCurrentPage(page);
  }, [currentPage]);

  const renderPage = ({ item }: { item: PageData }) => {
    return (
      <View style={[pageStyles.container, { width: SCREEN_WIDTH }]}>
        <View style={pageStyles.iconContainer}>{item.icon}</View>
        <Text style={[pageStyles.title, { color: colors.onboardingText }]}>{item.title}</Text>
        <Text style={[pageStyles.description, { color: colors.onboardingTextMuted }]}>{item.description}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.onboardingGradient}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <FlatList
          ref={flatListRef}
          data={PAGES}
          renderItem={renderPage}
          keyExtractor={(item) => item.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          bounces={false}
        />

        {/* Bottom section: dots + button */}
        <View style={styles.bottomSection}>
          {/* Dot indicators */}
          <View style={styles.dots}>
            {PAGES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: colors.onboardingText + '4D' },
                  i === currentPage && [styles.dotActive, { backgroundColor: colors.onboardingText }],
                ]}
              />
            ))}
          </View>

          {/* Action buttons -- changes based on page */}
          {isLastPage ? (
            <>
              <TouchableOpacity
                style={[styles.nextButton, { backgroundColor: colors.onboardingButton }]}
                onPress={() => { logOnboardingHaveInviteCode('carousel'); onHaveInviteCode(); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.nextButtonText, { color: colors.onboardingButtonText }]}>I have an invite code</Text>
              </TouchableOpacity>
              {__DEV__ && <Text style={[styles.hackathonHint, { color: colors.onboardingText }]}>For hackathon - enter SEEKER</Text>}
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.onboardingText + '66' }]}
                onPress={() => { logOnboardingJoinWaitlist(); onJoinWaitlist(); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.onboardingText }]}>Join the waitlist</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.nextButton, { backgroundColor: colors.onboardingButton }]}
                onPress={handleNext}
                activeOpacity={0.7}
              >
                <Text style={[styles.nextButtonText, { color: colors.onboardingButtonText }]}>Next</Text>
              </TouchableOpacity>
              {/* Invisible spacer matching the second button height so content doesn't shift */}
              <View style={styles.buttonSpacer} />
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
  },
  nextButton: {
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
  buttonSpacer: {
    // Matches the secondary button height: borderWidth(2) + paddingVertical(16) + text(~20) + paddingVertical(16) + borderWidth(2)
    height: 56,
  },
  secondaryButton: {
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
  hackathonHint: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.6,
  },
});

const pageStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});
